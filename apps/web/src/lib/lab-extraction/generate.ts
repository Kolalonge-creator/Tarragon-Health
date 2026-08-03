import "server-only";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";
import { RESULT_DOC_BUCKET } from "@/lib/lab-results/documents";
import {
  EXTRACTABLE_ANALYTE_CODES,
  EXTRACTABLE_ANALYTE_LABEL,
  extractionResultSchema,
  toProposedReadings,
  type ProposedReading,
} from "./analytes";

const MODEL_ID = "claude-haiku-4-5";

/** Image types Claude vision accepts. HEIC is not one of them. */
const VISION_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const ANALYTE_LIST = EXTRACTABLE_ANALYTE_CODES.map(
  (code) => `- ${code} (${EXTRACTABLE_ANALYTE_LABEL[code]})`
).join("\n");

const SYSTEM_PROMPT = `You are reading a laboratory report for a Nigerian digital health platform and
transcribing the numbers on it. You are a transcriber, not a clinician.

Rules, no exceptions:
- Report ONLY these analytes, using exactly these codes:
${ANALYTE_LIST}
- Report the value and the unit EXACTLY as printed on the document. Do not convert
  between units, do not rescale, do not round. Unit conversion happens elsewhere.
- If a value is not on the document, omit it. Never infer, estimate, or carry a
  number over from a reference range, a previous column, or your own knowledge.
- Reference ranges, normal ranges and flags like "H"/"L" are NOT results. Ignore them.
- If a value is illegible or ambiguous, omit it rather than guessing.
- taken_on: the date the sample was collected or reported, as YYYY-MM-DD, only if
  the document states one. Omit it otherwise.
- source_text: the short snippet of the document you read each value from, so a
  clinician can check you.
- Never write an interpretation, a diagnosis, a comment on whether a value is
  normal, or any advice. You are producing data for a doctor to review, nothing else.`;

export interface ExtractionOutcome {
  status: "ready" | "failed";
  proposed: ProposedReading[];
  error?: string;
}

/**
 * Read an uploaded result document into structured analyte proposals.
 *
 * NEVER THROWS. Same fail-open discipline as lib/case-briefs/generate.ts,
 * lib/patient-explainer/generate.ts and packages/shared/ml-client.ts: any
 * failure persists a 'failed' row and the clinician simply reads the document
 * by hand, exactly as they would have before this existed. Extraction being
 * down must never block a result reaching a doctor.
 *
 * Writes only to lab_result_extractions. Nothing here touches
 * lab_analyte_readings, screening_results, or any alert — a clinician
 * confirming via public.confirm_lab_result_extraction is the only path from
 * this proposal into the clinical record.
 */
export async function generateLabResultExtraction(
  service: SupabaseClient<Database>,
  params: {
    documentId: string;
    organisationId: string;
    patientId: string;
    filePath: string;
    mimeType: string | null;
  },
  /** Injectable for tests; defaults to a real Claude client. */
  model?: ChatAnthropic
): Promise<ExtractionOutcome> {
  const { documentId, organisationId, patientId, filePath, mimeType } = params;

  const mime = mimeType ?? "";
  const isPdf = mime === "application/pdf";
  if (!isPdf && !VISION_MIME.has(mime)) {
    return persistFailure(service, params, "That file type can't be read automatically yet.");
  }

  let base64: string;
  try {
    const { data, error } = await service.storage.from(RESULT_DOC_BUCKET).download(filePath);
    if (error || !data) throw error ?? new Error("Document not found in storage");
    base64 = Buffer.from(await data.arrayBuffer()).toString("base64");
  } catch (error) {
    console.error("lab-extraction: could not download document", error);
    return persistFailure(service, params, "Could not open the uploaded file.");
  }

  try {
    const chatModel =
      model ??
      new ChatAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: MODEL_ID,
        maxTokens: 1500,
        // Same claude-*-5-generation workaround as case-briefs/generate.ts --
        // @langchain/anthropic@0.3.x unconditionally sends temperature/top_p/
        // top_k, which this model generation rejects outright.
        invocationKwargs: { temperature: undefined, top_p: undefined, top_k: undefined },
      });
    const structuredModel = chatModel.withStructuredOutput(extractionResultSchema);

    const filePart = isPdf
      ? {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64 },
        }
      : {
          type: "image_url",
          image_url: { url: `data:${mime};base64,${base64}` },
        };

    const parsed = await structuredModel.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage({
        content: [
          filePart,
          {
            type: "text",
            text: "Transcribe the laboratory values from this report, following the rules exactly.",
          },
        ],
      }),
    ]);

    const proposed = toProposedReadings(parsed);

    await service.from("lab_result_extractions").upsert(
      {
        organisation_id: organisationId,
        patient_id: patientId,
        document_id: documentId,
        status: "ready",
        model_id: MODEL_ID,
        proposed: proposed as unknown as Json,
        error_message: null,
      },
      { onConflict: "document_id" }
    );

    return { status: "ready", proposed };
  } catch (error) {
    console.error("lab-extraction: generation failed, degrading to manual reading", error);
    return persistFailure(
      service,
      params,
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

async function persistFailure(
  service: SupabaseClient<Database>,
  params: { documentId: string; organisationId: string; patientId: string },
  errorMessage: string
): Promise<ExtractionOutcome> {
  try {
    await service.from("lab_result_extractions").upsert(
      {
        organisation_id: params.organisationId,
        patient_id: params.patientId,
        document_id: params.documentId,
        status: "failed",
        model_id: MODEL_ID,
        proposed: [] as unknown as Json,
        error_message: errorMessage,
      },
      { onConflict: "document_id" }
    );
  } catch (error) {
    console.error("lab-extraction: could not persist failure", error);
  }
  return { status: "failed", proposed: [], error: errorMessage };
}
