import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { type Database, type Json } from "@tarragon/shared";
import { createGovernedMlClient } from "./governed-ml-client";
import { bpControlRiskLevel } from "@/lib/rules/bp-control-risk";
import { queueRiskSignalAttentionBestEffort } from "@/lib/notifications/queue-risk-signal-attention";

/**
 * How far back to fetch readings — wider than services/ml's own 30-day
 * control-rate window (CONTROL_WINDOW_DAYS) because the same request also
 * feeds its 6-month assess_sustained_control (LONG_WINDOW_MONTHS=6).
 * assess_bp_control still correctly restricts itself to the trailing 30
 * days from `as_of` no matter how much further back the supplied readings
 * go, so widening this query doesn't change the 30-day score — it only
 * gives the sustained assessment the history it needs. ~186 days covers 6
 * full calendar months with margin.
 */
const BP_READING_FETCH_WINDOW_DAYS = 186;
/** Below this reading count a control-rate percentage is too noisy to nudge a patient over. */
const MIN_READINGS_FOR_ATTENTION_NUDGE = 5;

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
  const mlClient = createGovernedMlClient(supabase, {
    subjectProfileId: patientId,
    inputCategory: "bp_control_assessment",
  });
  if (!mlClient) return;

  const since = new Date(
    Date.now() - BP_READING_FETCH_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
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

  const sustainedElevation = assessment.sustained?.sustained_elevation_flag === true;
  const thirtyDayRiskLevel =
    assessment.control_rate_percent !== null
      ? bpControlRiskLevel(assessment.control_rate_percent)
      : null;
  // A 6-month sustained pattern is never masked by a good last 30 days —
  // floor the level at "high" rather than let a recent good stretch hide it.
  const thirtyDayIsBelowHigh =
    thirtyDayRiskLevel === null || thirtyDayRiskLevel === "low" || thirtyDayRiskLevel === "moderate";
  const riskLevel = sustainedElevation && thirtyDayIsBelowHigh ? "high" : thirtyDayRiskLevel;

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
      risk_level: riskLevel,
      model_version: "bp_control_v1",
      inputs: assessment as unknown as Json,
    });

  if (
    (riskLevel === "high" || riskLevel === "very_high") &&
    assessment.readings_in_window >= MIN_READINGS_FOR_ATTENTION_NUDGE
  ) {
    await queueRiskSignalAttentionBestEffort(
      patientId,
      organisationId,
      "bp_control",
      "Blood pressure control",
      sustainedElevation
        ? "has been elevated for several months"
        : "has needed extra attention recently"
    );
  }
}
