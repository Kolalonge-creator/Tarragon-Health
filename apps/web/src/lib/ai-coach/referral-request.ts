import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums } from "@tarragon/shared";

/**
 * §36.10 "health navigation" — the referral-write path, built on an explicit
 * founder ask (2026-08-29) overriding the standing guardrail in CLAUDE.md's
 * Clinical Tier Ladder section and docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md
 * §3.
 *
 * DELIBERATELY NOT an insert into public.specialist_referrals. That table
 * has always been staff/trigger-created only (see migration
 * 20260829113000_alert_type_code_referral_requested.sql's own header for
 * the two prior migrations that state this explicitly, and the reasons —
 * the protocol-scope-referral safety gate and several downstream triggers
 * all assume a referral's provenance is a trusted staff/system action).
 * Undermining that would be a real safety regression this session judged
 * out of scope even under an explicit ask to "build it end to end" — the
 * end-to-end feature this file builds instead is: patient asks (via chat)
 * → real clinician_alerts row + care_messages thread → a clinician (Tier 4
 * per the Clinical Tier Ladder — "approves referrals") reviews it and, if
 * appropriate, creates the actual specialist_referrals row through the
 * existing, completely unchanged staff-only path. The referral itself is
 * still always a human clinical decision; this closes the "no way to even
 * ask" gap, not the "who may create a binding referral" gate.
 */
export interface ReferralRequestParams {
  organisationId: string;
  patientId: string;
  conversationId: string;
  specialistType: Enums<"specialist_type">;
  /** The patient's own words (as relayed by the assistant), for the
   * clinician's context. */
  reason: string;
}

export interface ReferralRequestResult {
  clinicianAlertId: string;
  /** Null when opening the care_messages thread failed — best-effort, same
   * "log and continue" shape as escalate.ts's logAiCoachEscalation. */
  careMessageThreadId: string | null;
}

export async function requestSpecialistReferral(
  /** The PATIENT'S OWN RLS-scoped session — required for start_care_thread(),
   * same reason as escalate.ts's logAiCoachEscalation. */
  patientSupabase: SupabaseClient<Database>,
  serviceRoleSupabase: SupabaseClient<Database>,
  params: ReferralRequestParams
): Promise<ReferralRequestResult> {
  const { organisationId, patientId, conversationId, specialistType, reason } = params;
  const detail = `AI Coach conversation ${conversationId}: patient asked to see a ${specialistType} specialist. Reason given: "${reason}"`;

  // category/type_code set explicitly rather than left to
  // classify_and_assign_clinician_alert()'s BEFORE INSERT fallback (which
  // only classifies an unrecognised type_code as generic 'clinical') — same
  // "generator already sets them" pattern escalate.ts already follows.
  const { data: alert, error: alertError } = await serviceRoleSupabase
    .from("clinician_alerts")
    .insert({
      organisation_id: organisationId,
      patient_id: patientId,
      level: "clinician_review",
      status: "open",
      title: `Patient requested a ${specialistType} referral`,
      detail,
      // Same 72-hour convention as logAiCoachReviewFlag — a routing
      // request, not an urgent safety concern.
      sla_due_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      category: "care_management",
      type_code: "referral_requested",
    })
    .select("id")
    .single();
  if (alertError || !alert) {
    throw new Error(alertError?.message ?? "Could not create clinician alert");
  }

  await serviceRoleSupabase.from("audit_log").insert({
    organisation_id: organisationId,
    actor_id: patientId,
    action: "ai_coach.referral_requested",
    entity_type: "clinician_alerts",
    entity_id: alert.id,
    event: { conversation_id: conversationId, specialist_type: specialistType },
  });

  // §36.14 human handoff — same care_messages pattern as escalate.ts's
  // emergency path, but unlinked (no escalation_id — a referral request
  // never creates an `escalations` row, matching logAiCoachReviewFlag's own
  // "clinician_review isn't an escalation" design). Best-effort: a failure
  // here must not lose the already-persisted clinician_alerts row.
  let careMessageThreadId: string | null = null;
  try {
    const { data, error } = await patientSupabase.rpc("start_care_thread", {
      p_subject: `Referral request: ${specialistType}`,
      p_body: `I asked the AI Coach to help me see a ${specialistType} specialist. ${reason}`,
    });
    if (error) {
      console.error("ai-coach: could not open care_messages thread for referral request", error);
    } else {
      careMessageThreadId = data;
    }
  } catch (error) {
    console.error("ai-coach: start_care_thread threw for referral request", error);
  }

  return { clinicianAlertId: alert.id, careMessageThreadId };
}
