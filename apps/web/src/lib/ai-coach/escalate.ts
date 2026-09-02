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
export interface EmergencyEscalationResult {
  clinicianAlertId: string;
  escalationId: string;
  /** Null when opening the care_messages thread failed — best-effort, see
   * the call site below. Never null just because it wasn't attempted; this
   * function always attempts it for every emergency escalation. */
  careMessageThreadId: string | null;
}

export async function logAiCoachEscalation(
  /** The PATIENT'S OWN RLS-scoped session, not service-role — required to
   * open a care_messages thread below: start_care_thread() is `security
   * definer` but still keys off `auth.uid()` internally (see its own
   * migration comment), which a service-role call carries no JWT for. */
  patientSupabase: SupabaseClient<Database>,
  serviceRoleSupabase: SupabaseClient<Database>,
  params: AiCoachAlertParams
): Promise<EmergencyEscalationResult> {
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
      // Explicit rather than left to the trigger's title-pattern fallback:
      // this is a patient self-report surfaced through conversation, the
      // same real-world event category as an emergency_events/danger-symptom
      // report (8.1 symptom_escalation).
      category: "clinical",
      type_code: "symptom_escalation",
    })
    .select("id")
    .single();
  if (alertError || !alert) {
    throw new Error(alertError?.message ?? "Could not create clinician alert");
  }

  // .select().single() here (unlike before) so the ai_assistant_turns audit
  // row (audit.ts, called from index.ts) can record the real escalations.id
  // alongside clinician_alert_id — previously this function returned only
  // the alert id and the escalation row's own id was never captured anywhere
  // in application code.
  const { data: escalation, error: escalationError } = await serviceRoleSupabase
    .from("escalations")
    .insert({
      organisation_id: organisationId,
      patient_id: patientId,
      clinician_alert_id: alert.id,
      status: "open",
      reason: detail,
    })
    .select("id")
    .single();
  if (escalationError || !escalation) {
    throw new Error(escalationError?.message ?? "Could not create escalation");
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

  // §36.14 "human handoff... conversation continues" — closes the gap
  // docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md §5/§7 Phase D names: before
  // this, an AI-Coach-flagged emergency opened a clinician_alerts row with
  // no channel for the clinician's reply to reach the patient in-app. This
  // opens a real care_messages thread (the platform's actual patient↔care-
  // team channel per CLAUDE.md's 2026-07-30 rule — never WhatsApp), linked
  // to the escalation via care_message_threads.escalation_id, with the
  // trigger message as the opening note. Called with patientSupabase (not
  // service-role) because start_care_thread() keys off auth.uid() — see
  // this function's own param doc. Best-effort: a failure here must not
  // lose the (already-persisted) clinician escalation above, same "log and
  // continue" discipline as the emergency_events insert just above it.
  let careMessageThreadId: string | null = null;
  try {
    const { data, error } = await patientSupabase.rpc("start_care_thread", {
      p_subject: "AI Coach: possible emergency reported",
      p_body: `I mentioned this to the AI Coach just now: "${triggerMessage}". Sharing it here so my care team can follow up.`,
      p_escalation_id: escalation.id,
    });
    if (error) {
      console.error("ai-coach: could not open care_messages thread for escalation", error);
    } else {
      careMessageThreadId = data;
    }
  } catch (error) {
    console.error("ai-coach: start_care_thread threw", error);
  }

  return { clinicianAlertId: alert.id, escalationId: escalation.id, careMessageThreadId };
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
): Promise<{ clinicianAlertId: string }> {
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
      category: "clinical",
      type_code: "symptom_escalation",
    })
    .select("id")
    .single();
  if (error || !alert) {
    throw new Error(error?.message ?? "Could not create clinician alert");
  }

  return { clinicianAlertId: alert.id };
}
