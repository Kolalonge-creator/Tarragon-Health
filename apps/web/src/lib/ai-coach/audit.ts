import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";
import type { CoachTier } from "@tarragon/shared";

/**
 * §36.17 per-turn provenance record — closes the audit gap described in
 * docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md §4.3. Mirrors the
 * case_briefs/patient_result_explanations discipline (model_id +
 * input_snapshot + status/error_message) that the chat never had.
 *
 * Best-effort and never throws — this is a governance/diagnostic record,
 * not the clinical-safety record itself (that's still clinician_alerts/
 * escalations, written by escalate.ts, which correctly DOES throw on
 * failure). A failed audit write must never be the reason a patient-facing
 * turn breaks or a real escalation is lost.
 */
export interface LogAssistantTurnParams {
  organisationId: string;
  patientId: string;
  conversationId: string;
  interactionType: "chat_turn" | "record_explanation" | "care_plan_summary" | "appointment_prep";
  /** Null when the turn never reached a model call (access denied, rate
   * limited, or the keyword guardrail alone resolved it). */
  modelId?: string | null;
  promptVersion?: string | null;
  /** Null only on the two short-circuit statuses, where classification
   * never ran. */
  safetyClassification?: CoachTier | null;
  /** Approved-content ids the retrieval stage actually surfaced for this
   * turn. Empty array (not omitted) when retrieval ran and found nothing. */
  retrievedSourceIds?: string[];
  /** Set only when this turn actually caused one to exist. */
  clinicianAlertId?: string | null;
  escalationId?: string | null;
  finalAction: "replied" | "clinician_alert_created" | "escalation_created" | "declined";
  status: "completed" | "degraded" | "access_denied" | "rate_limited";
  errorMessage?: string | null;
  /** Exactly what was sent to the model — context lines, retrieved
   * content, prior-message window — never the raw patient message body
   * (that already lives in ai_conversations.messages). */
  inputSnapshot?: Record<string, unknown>;
}

export async function logAssistantTurn(
  serviceRoleSupabase: SupabaseClient<Database>,
  params: LogAssistantTurnParams
): Promise<string | null> {
  try {
    const { data, error } = await serviceRoleSupabase
      .from("ai_assistant_turns")
      .insert({
        organisation_id: params.organisationId,
        patient_id: params.patientId,
        conversation_id: params.conversationId,
        interaction_type: params.interactionType,
        model_id: params.modelId ?? null,
        prompt_version: params.promptVersion ?? null,
        safety_classification: params.safetyClassification ?? null,
        retrieved_source_ids: params.retrievedSourceIds ?? [],
        clinician_alert_id: params.clinicianAlertId ?? null,
        escalation_id: params.escalationId ?? null,
        final_action: params.finalAction,
        status: params.status,
        error_message: params.errorMessage ?? null,
        input_snapshot: (params.inputSnapshot ?? {}) as Json,
      })
      .select("id")
      .single();
    if (error || !data) {
      console.error("ai-coach: could not write ai_assistant_turns row", error);
      return null;
    }
    return data.id;
  } catch (error) {
    console.error("ai-coach: logAssistantTurn threw", error);
    return null;
  }
}
