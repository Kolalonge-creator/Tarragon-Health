import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export interface EscalateParams {
  organisationId: string;
  patientId: string;
  conversationId: string;
  /** The patient's message that triggered the emergency tier, for the
   * clinician's context — never the coach's own reply. */
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
  params: EscalateParams
): Promise<string> {
  const { organisationId, patientId, conversationId, triggerMessage } = params;
  const detail = `AI Coach conversation ${conversationId} — patient wrote: "${triggerMessage}"`;

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
