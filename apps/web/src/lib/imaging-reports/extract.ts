import "server-only";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

/**
 * Imaging/radiology report vision boundary — AI-016. Reads a photo or PDF of
 * a radiology/imaging report and transcribes the radiologist's own
 * Impression/Conclusion section VERBATIM, plus a narrow flag for whether
 * that wording states something other than normal.
 *
 * AI DRAFTS, NEVER DECIDES — same discipline as lib/lab-reports/extract.ts
 * and lib/ecg-reports/extract.ts, taken further here on purpose: this module
 * does not even attempt to read the scan IMAGE (the X-ray/CT/MRI itself).
 * It transcribes what a licensed radiologist ALREADY wrote in their own
 * report. `impressionIndicatesFinding` is not a diagnosis of our own — it is
 * a factual claim about what the radiologist's OWN WORDING says, with an
 * explicit instruction to default toward true (flagged) whenever that
 * reading is genuinely ambiguous, the same asymmetric-risk posture as every
 * abnormal-pathway check on this platform.
 *
 * Never throws. On any failure (no key, timeout, malformed output,
 * unreadable document) it returns a definitive failure and the caller
 * persists a `failed` extraction.
 *
 * Produces no clinician-confirmable draft and writes nothing to any
 * clinical record — imaging_reports stays entirely clinician-filed and
 * manual (fileImagingReport, lib/imaging-reports/actions.ts), completely
 * unaffected by this module. This powers ONLY the patient-facing automated
 * summary (imaging_report_documents.ai_summary_status).
 */

const REQUEST_TIMEOUT_MS = 30_000;
const MODEL_ID = "claude-sonnet-5";

const rawExtractionSchema = z.object({
  /** The radiologist's own Impression/Conclusion section, copied VERBATIM,
   * including its own heading if printed (e.g. "IMPRESSION: ..."). Null when
   * the report has no distinct Impression/Conclusion section at all. */
  impression_text: z.string().nullable(),
  /** Whether the radiologist's OWN wording states something other than
   * normal/unremarkable. Defaults to true whenever genuinely ambiguous. */
  impression_indicates_finding: z.boolean().nullable(),
  /** Study date exactly as printed, ISO-8601 if the model can. */
  study_date: z.string().nullable(),
  /** Facility or radiologist name as printed, if any. */
  facility_name: z.string().nullable(),
  /** Patient name as printed — kept for a future mismatch warning only,
   * never stored. */
  patient_name: z.string().nullable(),
  /** Set when the image is too poor, cropped, or not an imaging/radiology
   * report at all. */
  unreadable_reason: z.string().nullable(),
});

export interface ImagingReportExtraction {
  impressionText: string | null;
  impressionIndicatesFinding: boolean | null;
  studyDate: string | null;
  facilityName: string | null;
  patientNameOnReport: string | null;
  unreadableReason: string | null;
}

export type ImagingReportExtractionResult =
  | { ok: true; extraction: ImagingReportExtraction }
  | { ok: false; reason: "unavailable" | "error" | "unsupported_type" };

export const EXTRACTABLE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export function isImagingReportExtractionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM_PROMPT = [
  "You transcribe the printed Impression/Conclusion section of a radiology or imaging report",
  "(X-ray, ultrasound, CT, MRI, mammogram, etc.) for a Nigerian digital health platform.",
  "",
  "Your ONLY job is faithful transcription of what the RADIOLOGIST ALREADY WROTE in their own",
  "report. You are not looking at the scan image itself, not forming a diagnosis of your own,",
  "and not judging the severity of anything. A doctor reviews the original document; this only",
  "helps a patient see what the report already says without waiting.",
  "",
  "Rules, no exceptions:",
  "- impression_text: copy the report's own Impression, Conclusion, or equivalent summary",
  "  section VERBATIM, including its own heading if printed (e.g. \"IMPRESSION:\"). Do not",
  "  paraphrase, summarise, shorten, or add a single word of your own. If the report has",
  "  Findings but genuinely no distinct Impression/Conclusion section, set impression_text to",
  "  null rather than inventing one from the Findings.",
  "- impression_indicates_finding: true if the radiologist's OWN WORDING states, names, or",
  "  describes anything other than a normal/unremarkable/negative result — a specific finding,",
  "  a diagnosis, an abnormality, a recommendation for follow-up or further imaging, or a",
  "  comparison showing a change. false ONLY when the wording clearly states normal, negative,",
  "  unremarkable, or no acute finding, with nothing else raised. If the wording is genuinely",
  "  ambiguous, incomplete, or you are not confident it is clearly normal, set this to true —",
  "  never guess false. Leave null only when impression_text itself is null.",
  "- study_date, facility_name, patient_name: copy exactly as printed, or null if not shown.",
  "- If the document is not a radiology/imaging report at all, or is too blurred/cropped to",
  "  transcribe safely, set unreadable_reason and leave every other field null.",
].join("\n");

/**
 * Read an imaging/radiology report document and transcribe its own
 * Impression/Conclusion section. Never throws.
 */
export async function extractImagingReport(input: {
  fileBase64: string;
  mediaType: string;
  /** Test-injectable model, same shape as extractLabReport/extractEcgReport. */
  model?: ChatAnthropic;
}): Promise<ImagingReportExtractionResult> {
  if (!input.model && !isImagingReportExtractionConfigured()) {
    return { ok: false, reason: "unavailable" };
  }
  if (!(EXTRACTABLE_MIME_TYPES as readonly string[]).includes(input.mediaType)) {
    return { ok: false, reason: "unsupported_type" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const model =
      input.model ??
      new ChatAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: MODEL_ID,
        maxTokens: 2000,
        // Same claude-*-5-generation workaround as lab-reports/ecg-reports
        // extract.ts: @langchain/anthropic@0.3.x unconditionally sends these,
        // and this model generation rejects them outright.
        invocationKwargs: { temperature: undefined, top_p: undefined, top_k: undefined },
      });
    const structured = model.withStructuredOutput(rawExtractionSchema, {
      name: "imaging_report_extraction",
    });

    const documentBlock =
      input.mediaType === "application/pdf"
        ? {
            type: "document" as const,
            source: {
              type: "base64" as const,
              media_type: "application/pdf" as const,
              data: input.fileBase64,
            },
          }
        : {
            type: "image_url" as const,
            image_url: { url: `data:${input.mediaType};base64,${input.fileBase64}` },
          };

    const raw = await structured.invoke(
      [
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage({
          content: [
            {
              type: "text",
              text: "Transcribe this imaging/radiology report's own Impression/Conclusion section as instructed.",
            },
            documentBlock,
          ],
        }),
      ],
      { signal: controller.signal },
    );

    const parsed = rawExtractionSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: "error" };
    const d = parsed.data;

    const impressionText = d.impression_text?.trim() || null;
    return {
      ok: true,
      extraction: {
        impressionText,
        // Only meaningful when there is an impression to judge at all — and
        // biased toward true (flagged) whenever the model left it
        // unset/ambiguous, per the system prompt's own instruction.
        impressionIndicatesFinding: impressionText ? (d.impression_indicates_finding ?? true) : null,
        studyDate: d.study_date,
        facilityName: d.facility_name,
        patientNameOnReport: d.patient_name,
        unreadableReason: d.unreadable_reason,
      },
    };
  } catch (error) {
    console.error("imaging-reports: extraction failed", error);
    return { ok: false, reason: "error" };
  } finally {
    clearTimeout(timer);
  }
}
