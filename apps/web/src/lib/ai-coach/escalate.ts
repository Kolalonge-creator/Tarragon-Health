import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export interface AiCoachAlertParams {
  organisationId: string;
  patientId: string;
  conversationId: string;
  /** The patient's message that triggered the tier, for the clinician's
   * context — never the coach's own reply. */
  triggerMessage: string;
}

/**
 * Writes the clinician_alerts + escalations + audit_log rows for an
 * AI-Coach-flagged emergency. Uses the service-role client (see
 * apps/web/src/lib/supabase/service-role.ts) because clinician_alerts/
 * escalations are staff-write-only tables — the same pattern already used
 * in patient/actions.ts for `prevention_risk_scores`/`screening_schedules`:
 * the tier here is a value the app computed on the patient's behalf, not
 * raw patient input, so RLS can't be trusted to let the patient write it
 * directly, but a patient-triggered write is still exactly what should
 * happen.
 */
export async function logAiCoachEscalation(
  serviceRoleSupabase: SupabaseClient<Database>,
  params: AiCoachAlertParams
): Promise<string> {
  const { organisationId, patientId, conversationId, triggerMessage } = params;
  const detail = `AI Coach conversation ${conversationId}: patient wrote "${triggerMessage}"`;

  const { data: alert, error: alertError } = await serviceRoleSupabase
    .from("clinician_alerts")
    .insert({
      organisation_id: organisationId,
      patient_id: patientId,
      level: "emergency",
      status: "open",
      title: "AI Coach: possible emergency reported",
      detail,
      sla_due_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (alertError || !alert) {
    throw new Error(alertError?.message ?? "Could not create clinician alert");
  }

  const { error: escalationError } = await serviceRoleSupabase.from("escalations").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    clinician_alert_id: alert.id,
    status: "open",
    reason: detail,
  });
  if (escalationError) {
    throw new Error(escalationError.message);
  }

  // Surface the same acknowledge-gated emergency pathway to the patient that a
  // danger-symptom checklist or symptom-log red flag raises. clinician_alert_id
  // is passed so private.handle_emergency_event() reuses the alert we just
  // created instead of raising a second one. A failure here must not lose the
  // (already-persisted) clinician escalation above — the patient-facing alert
  // is additive, so we log and continue rather than throw.
  const { error: emergencyEventError } = await serviceRoleSupabase.from("emergency_events").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    source: "ai_coach",
    trigger_detail: detail,
    clinician_alert_id: alert.id,
    status: "active",
  });
  if (emergencyEventError) {
    console.error("ai-coach: could not create emergency_events row", emergencyEventError);
  }

  await serviceRoleSupabase.from("audit_log").insert({
    organisation_id: organisationId,
    actor_id: patientId,
    action: "ai_coach.emergency_escalation",
    entity_type: "clinician_alerts",
    entity_id: alert.id,
    event: { conversation_id: conversationId },
  });

  return alert.id;
}

/**
 * Writes just the clinician_alerts row for an AI-Coach turn tiered
 * `clinician_review` — flagged, but not urgent enough to be an escalation.
 * Deliberately lighter than logAiCoachEscalation above: no `escalations` or
 * `emergency_events` row, because clinician_review isn't an escalation, it's
 * a "worth a doctor's look" flag. Before this existed, a clinician_review
 * turn only ever wrote an audit_log entry (see graph.ts's logReview node) —
 * correct for the record, but nobody's dashboard reads audit_log, so a real
 * concern could sit unseen indefinitely. Same service-role rationale as
 * logAiCoachEscalation: clinician_alerts is staff-write-only.
 */
export async function logAiCoachReviewFlag(
  serviceRoleSupabase: SupabaseClient<Database>,
  params: AiCoachAlertParams
): Promise<string> {
  const { organisationId, patientId, conversationId, triggerMessage } = params;
  const detail = `AI Coach conversation ${conversationId}: patient wrote "${triggerMessage}"`;

  const { data: alert, error } = await serviceRoleSupabase
    .from("clinician_alerts")
    .insert({
      organisation_id: organisationId,
      patient_id: patientId,
      level: "clinician_review",
      status: "open",
      title: "AI Coach: flagged for clinician review",
      detail,
      // Same 72-hour SLA convention already used for the clinician_review
      // level elsewhere (private.handle_lpe_red_flag()'s amber mapping) —
      // not urgent, but must not silently vanish.
      sla_due_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (error || !alert) {
    throw new Error(error?.message ?? "Could not create clinician alert");
  }

  return alert.id;
}
