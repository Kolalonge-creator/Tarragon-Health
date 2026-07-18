import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createMlClientFromEnv, type Database, type Json } from "@tarragon/shared";

/** Trailing window for BP-control assessment, matching services/ml's CONTROL_WINDOW_DAYS. */
const BP_CONTROL_WINDOW_DAYS = 30;

/**
 * Best-effort BP-control assessment after a blood_pressure vitals insert —
 * shared by every insertion path (manual logVital, device-sync ingestion)
 * so the ML risk-scoring pipeline never depends on which path wrote the
 * reading. Never throws and never blocks the caller's own success response
 * — the ML service is stateless/optional per CLAUDE.md ("platform must
 * keep working if ML is down"), so any failure here (client unconfigured,
 * ML down, insufficient history) is a silent no-op, not a user-facing
 * error.
 *
 * Takes the caller's own RLS-scoped client rather than constructing one —
 * the cookie-based web client and the bearer-token mobile client both
 * authenticate as the patient, but only the caller knows which one is live
 * in its own request context.
 */
export async function assessBpControlBestEffort(
  supabase: SupabaseClient<Database>,
  patientId: string,
  organisationId: string
): Promise<void> {
  const mlClient = createMlClientFromEnv();
  if (!mlClient) return;

  const since = new Date(Date.now() - BP_CONTROL_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: readings } = await supabase
    .from("vitals_readings")
    .select("taken_at, systolic, diastolic")
    .eq("patient_id", patientId)
    .eq("vital_type", "blood_pressure")
    .gte("taken_at", since)
    .order("taken_at", { ascending: true });

  if (!readings || readings.length === 0) return;

  const assessment = await mlClient.bpControl({
    readings: readings
      .filter((r) => r.systolic !== null && r.diastolic !== null)
      .map((r) => ({
        taken_at: r.taken_at,
        systolic: r.systolic as number,
        diastolic: r.diastolic as number,
      })),
  });
  if (!assessment) return;

  // patient_risk_scores is staff-only-write by RLS (is_org_staff) — this is
  // a system computation, not the patient's own raw input, same reasoning
  // as prevention_risk_scores/screening_schedules elsewhere.
  await createServiceRoleClient()
    .from("patient_risk_scores")
    .insert({
      organisation_id: organisationId,
      patient_id: patientId,
      score_type: "bp_control",
      score: assessment.control_rate_percent,
      model_version: "bp_control_v1",
      inputs: assessment as unknown as Json,
    });
}
