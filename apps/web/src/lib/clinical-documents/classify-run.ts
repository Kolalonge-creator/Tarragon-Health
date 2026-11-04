import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getProposedConfig, type ConfigValue, type Database } from "@tarragon/shared";
import { AI_SYSTEMS, runGovernedAi } from "@/lib/ai-governance";
import { RESULT_DOC_BUCKET } from "@/lib/lab-results/documents";
import { normaliseForVision } from "@/lib/lab-reports/heic";
import { runLabReportExtraction } from "@/lib/lab-reports/extraction-actions";
import { classifyByRules } from "./classify-rules";
import { STUCK_AFTER_MINUTES } from "./retry";
import { CLASSIFIER_MODEL_ID, classifyDocument, type ClassifiableKind } from "./classify";

/**
 * Sorting one "I'm not sure what this is" upload (clinical document engine step 4). Deliberately NOT a "use server" module: it runs
 * with the service role and is called only by the patient's own upload action and the daily retry cron, after they checked who may
 * act. The database function it ends in (record_document_classification) is service-role only.
 *
 * Order (design §7): the fixed rules over the file name and note, then AI-024 through runGovernedAi (kill switch, audit trail).
 * A suggestion is APPLIED without asking only when AI-024 is confident (proposed-config documents.classifier) and no rule points to a
 * different pipeline. Everything else, including AI-024 being switched off or failing, asks the patient, with the best suggestion
 * pre-selected. Never throws.
 */

export interface ClassifierPolicy {
  readonly auto_apply_min_confidence: number;
  readonly max_classify_attempts: number;
}

export function classifierPolicy(): ClassifierPolicy {
  return getProposedConfig<ConfigValue>("documents.classifier").value as unknown as ClassifierPolicy;
}

export interface ClassificationDecision {
  readonly suggestedKind: string | null;
  readonly confidence: number | null;
  readonly source: "ai" | "rules";
  readonly system: string;
  readonly apply: boolean;
}

/**
 * Pure decision over what the rules and AI-024 said. Exported for tests: this is where "unsure goes to a person" lives.
 */
export function decideClassification(input: {
  rule: { kindCode: string; ruleId: string } | null;
  ai: { kindCode: string | null; confidence: number } | null;
  aiSystem: string;
  kinds: readonly ClassifiableKind[];
  policy: ClassifierPolicy;
}): ClassificationDecision {
  const pipelineOf = (code: string | null) => (code ? input.kinds.find((k) => k.code === code)?.pipeline ?? null : null);
  const { rule, ai } = input;
  if (ai?.kindCode && pipelineOf(ai.kindCode)) {
    const contradicted = rule !== null && pipelineOf(rule.kindCode) !== pipelineOf(ai.kindCode);
    return {
      suggestedKind: ai.kindCode,
      confidence: ai.confidence,
      source: "ai",
      system: input.aiSystem,
      apply: !contradicted && ai.confidence >= input.policy.auto_apply_min_confidence,
    };
  }
  if (rule && pipelineOf(rule.kindCode)) {
    return { suggestedKind: rule.kindCode, confidence: null, source: "rules", system: `rules:${rule.ruleId}`, apply: false };
  }
  return { suggestedKind: null, confidence: null, source: ai ? "ai" : "rules", system: ai ? input.aiSystem : "rules:none", apply: false };
}

export async function loadClassifiableKinds(service: SupabaseClient<Database>): Promise<ClassifiableKind[]> {
  const { data } = await service
    .from("clinical_document_kinds")
    .select("code, label, pipeline")
    .eq("is_active", true)
    .not("pipeline", "is", null)
    .order("sort_order");
  return (data ?? []).flatMap((k) => (k.pipeline ? [{ code: k.code, label: k.label, pipeline: k.pipeline }] : []));
}

type AiOutcome = { kindCode: string | null; confidence: number; error: string | null };

export async function runDocumentClassification(
  service: SupabaseClient<Database>,
  documentId: string,
): Promise<{ pipeline: string | null; asked: boolean }> {
  try {
    const { data: doc } = await service
      .from("clinical_documents")
      .select("id, patient_id, organisation_id, status, routed_table, file_path, mime_type, original_filename, patient_note")
      .eq("id", documentId)
      .maybeSingle();
    if (!doc || doc.status !== "classifying" || doc.routed_table !== null || !doc.file_path) return { pipeline: null, asked: false };

    const kinds = await loadClassifiableKinds(service);
    const rule = classifyByRules(doc.original_filename, doc.patient_note);
    const filePath = doc.file_path;

    let aiSystem = `${AI_SYSTEMS.documentClassifier.code}:${CLASSIFIER_MODEL_ID}`;
    const governed = await runGovernedAi<AiOutcome | null>({
      supabase: service,
      systemCode: AI_SYSTEMS.documentClassifier.code,
      inputCategory: "clinical_document",
      subjectProfileId: doc.patient_id,
      run: async ({ config }) => {
        const promptVersion = config?.prompt?.version ?? null;
        if (promptVersion !== null) aiSystem = `${aiSystem}:prompt-v${promptVersion}`;
        const { data: file, error } = await service.storage.from(RESULT_DOC_BUCKET).download(filePath);
        if (error || !file) return { value: null, modelIdentifier: CLASSIFIER_MODEL_ID, degradedReason: "Could not open the stored file" };
        const normalised = await normaliseForVision(Buffer.from(await file.arrayBuffer()), doc.mime_type);
        const result = await classifyDocument({
          fileBase64: normalised.buffer.toString("base64"),
          mediaType: normalised.mediaType,
          kinds,
        });
        if (!result.ok) {
          return { value: null, modelIdentifier: CLASSIFIER_MODEL_ID, degradedReason: `Classifier: ${result.reason}` };
        }
        return {
          value: { kindCode: result.kindCode, confidence: result.confidence, error: null },
          modelIdentifier: CLASSIFIER_MODEL_ID,
          outputSummary: result.kindCode ? `${result.kindCode} (${result.confidence.toFixed(2)})` : "no type",
          resultingAction: "document_type_suggested",
          resultingEntityType: "clinical_documents",
          resultingEntityId: doc.id,
        };
      },
      fallback: () => null,
    });

    const ai = governed.status === "completed" && governed.value ? governed.value : null;
    const decision = decideClassification({ rule, ai, aiSystem, kinds, policy: classifierPolicy() });
    const aiError =
      governed.status === "fallback" && governed.fallbackReason === "ai_error" ? "The classifier could not read the document" : null;

    const { data: pipeline, error } = await service.rpc("record_document_classification", {
      p_document: doc.id,
      p_suggested_kind: decision.suggestedKind as string,
      p_confidence: decision.confidence as number,
      p_source: decision.source,
      p_system: decision.system,
      p_apply: decision.apply,
      p_error: aiError as string,
    });
    if (error) {
      console.error("clinical-documents: could not record the classification", error);
      return { pipeline: null, asked: false };
    }
    if (pipeline === "lab") await startLabReader(service, doc.id);
    return { pipeline: pipeline ?? null, asked: !pipeline };
  } catch (error) {
    // The document stays 'classifying'; the daily retry picks it up and, after the last attempt, asks the patient.
    console.error("clinical-documents: classification failed", error);
    return { pipeline: null, asked: false };
  }
}

/** A document just routed into the lab path: start the AI-005 reader on its new lab row, exactly as a direct lab upload does. */
export async function startLabReader(service: SupabaseClient<Database>, documentId: string): Promise<void> {
  const { data: cd } = await service
    .from("clinical_documents")
    .select("routed_table, routed_id, patient_id, organisation_id, file_path, mime_type")
    .eq("id", documentId)
    .maybeSingle();
  if (!cd || cd.routed_table !== "lab_result_documents" || !cd.routed_id || !cd.file_path) return;
  await runLabReportExtraction(service, {
    documentId: cd.routed_id,
    organisationId: cd.organisation_id,
    patientId: cd.patient_id,
    filePath: cd.file_path,
    mimeType: cd.mime_type,
  });
}

/**
 * Daily sweep (from /api/cron/clinical-document-retry): an upload still 'classifying' after STUCK_AFTER_MINUTES was interrupted
 * (the server stopped mid-call). Try again, up to max_classify_attempts in all; after that, simply ask the patient. Either way the
 * document leaves 'classifying' toward a person or a reader, never silently.
 */
export async function retryStuckClassifications(
  service: SupabaseClient<Database>,
  now: Date = new Date(),
  limit = 50,
): Promise<{ considered: number; retried: number; asked: number } | { error: string }> {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MINUTES * 60_000).toISOString();
  const { data: docs, error } = await service
    .from("clinical_documents")
    .select("id, created_at")
    .eq("status", "classifying")
    .is("routed_table", null)
    .lt("status_changed_at", cutoff)
    .order("status_changed_at", { ascending: true })
    .limit(limit);
  if (error) return { error: error.message };

  const policy = classifierPolicy();
  const summary = { considered: docs?.length ?? 0, retried: 0, asked: 0 };
  for (const doc of docs ?? []) {
    const { count } = await service
      .from("clinical_document_jobs")
      .select("id", { count: "exact", head: true })
      .eq("document_id", doc.id)
      .eq("step", "classify");
    // An interrupted attempt records nothing, so the daily sweeps since upload count as attempts too: a document that keeps
    // crashing the classifier is asked about within max_classify_attempts days, never retried for ever.
    const sweepsSoFar = Math.floor((now.getTime() - new Date(doc.created_at).getTime()) / 86_400_000);
    if (Math.max((count ?? 0) + 1, sweepsSoFar) >= policy.max_classify_attempts) {
      await service.rpc("record_document_classification", {
        p_document: doc.id,
        p_suggested_kind: null as unknown as string,
        p_confidence: null as unknown as number,
        p_source: "rules",
        p_system: "retry",
        p_apply: false,
        p_error: "Could not be sorted automatically; the patient is asked",
      });
      summary.asked += 1;
    } else {
      summary.retried += 1;
      await runDocumentClassification(service, doc.id);
    }
  }
  return summary;
}
