import "server-only";
import type { AiGovernanceClient } from "./registry";
import type {
  AiIncidentCategory,
  AiInteractionStatus,
  AiOutputFlag,
  AiSafetyClassification,
} from "./types";

/**
 * Writers for the clinical AI audit trail (Module 40.11) and the incident
 * report (40.12).
 *
 * Both go through SECURITY DEFINER RPCs rather than a table write, so the
 * organisation, the acting account and the model-drift check are derived
 * server-side and cannot be forged by the caller. See the part-3 migration.
 *
 * NEITHER OF THESE THROWS. An audit write that fails must not take down the
 * patient-facing interaction it is recording — the interaction has already
 * happened by the time we get here, and losing the answer as well as the
 * record would make things worse, not better. Failures go to the server log
 * and return null.
 */



export interface RecordAiInteractionParams {
  /** Registry code, e.g. "AI-001". */
  readonly systemCode: string;
  /** The model that actually answered — checked against the approved version. */
  readonly modelIdentifier: string;
  /**
   * A CATEGORY of input, never the patient's own words. "symptom_question",
   * "lab_report_page", "case_brief_request". The raw text stays where the
   * patient's own RLS protects it.
   */
  readonly inputCategory: string;
  readonly status: AiInteractionStatus;
  readonly subjectProfileId?: string | null;
  /** Bounded summary of what was returned; truncated to 4,000 chars server-side. */
  readonly outputSummary?: string | null;
  readonly safetyClassification?: AiSafetyClassification | null;
  readonly guardrailsTriggered?: readonly string[];
  readonly outputFlags?: readonly AiOutputFlag[];
  readonly promptVersionId?: string | null;
  readonly knowledgeSourceIds?: readonly string[];
  readonly resultingAction?: string | null;
  readonly resultingEntityType?: string | null;
  readonly resultingEntityId?: string | null;
  readonly fallbackReason?: string | null;
  readonly latencyMs?: number | null;
  readonly inputTokenCount?: number | null;
  readonly outputTokenCount?: number | null;
  readonly errorMessage?: string | null;
}

export async function recordAiInteraction(
  supabase: AiGovernanceClient,
  params: RecordAiInteractionParams
): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc("record_ai_interaction", {
      p_system_code: params.systemCode,
      p_model_identifier: params.modelIdentifier,
      p_input_category: params.inputCategory,
      p_status: params.status,
      p_subject_profile_id: params.subjectProfileId ?? undefined,
      p_output_summary: params.outputSummary ?? undefined,
      p_safety_classification: params.safetyClassification ?? undefined,
      p_guardrails_triggered: params.guardrailsTriggered
        ? [...params.guardrailsTriggered]
        : undefined,
      p_output_flags: params.outputFlags ? [...params.outputFlags] : undefined,
      p_prompt_version_id: params.promptVersionId ?? undefined,
      p_knowledge_source_ids: params.knowledgeSourceIds
        ? [...params.knowledgeSourceIds]
        : undefined,
      p_resulting_action: params.resultingAction ?? undefined,
      p_resulting_entity_type: params.resultingEntityType ?? undefined,
      p_resulting_entity_id: params.resultingEntityId ?? undefined,
      p_fallback_reason: params.fallbackReason ?? undefined,
      p_latency_ms: params.latencyMs ?? undefined,
      p_input_token_count: params.inputTokenCount ?? undefined,
      p_output_token_count: params.outputTokenCount ?? undefined,
      p_error_message: params.errorMessage ?? undefined,
    });

    if (error) {
      console.error("ai-governance: could not record an AI interaction", {
        systemCode: params.systemCode,
        error,
      });
      return null;
    }

    return typeof data === "string" ? data : null;
  } catch (error) {
    console.error("ai-governance: could not record an AI interaction", {
      systemCode: params.systemCode,
      error,
    });
    return null;
  }
}

/** Records that a human overrode an AI output (40.11). */
export async function recordAiHumanOverride(
  supabase: AiGovernanceClient,
  interactionId: string,
  note: string,
  resultingAction?: string | null
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc("record_ai_human_override", {
      p_interaction_id: interactionId,
      p_note: note,
      p_resulting_action: resultingAction ?? undefined,
    });
    if (error) {
      console.error("ai-governance: could not record an AI override", { interactionId, error });
      return false;
    }
    return true;
  } catch (error) {
    console.error("ai-governance: could not record an AI override", { interactionId, error });
    return false;
  }
}

export interface ReportAiIncidentParams {
  readonly systemCode: string;
  readonly category: AiIncidentCategory;
  readonly description: string;
  readonly interactionId?: string | null;
}

/**
 * Files an AI safety incident (40.12). Unlike the audit writers above, this
 * one DOES surface its failure, because it is called from a form a person is
 * looking at: silently swallowing "the AI told me something wrong" would be
 * the worst possible failure mode for this particular feature.
 */
export async function reportAiSafetyIncident(
  supabase: AiGovernanceClient,
  params: ReportAiIncidentParams
): Promise<{ ok: true; incidentId: string } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc("report_ai_safety_incident", {
    p_system_code: params.systemCode,
    p_category: params.category,
    p_description: params.description,
    p_interaction_id: params.interactionId ?? undefined,
  });

  if (error) {
    console.error("ai-governance: could not file an AI safety incident", { params, error });
    return {
      ok: false,
      message: "We could not send that report just now. Please try again in a moment.",
    };
  }

  return typeof data === "string"
    ? { ok: true, incidentId: data }
    : { ok: false, message: "We could not send that report just now. Please try again in a moment." };
}
