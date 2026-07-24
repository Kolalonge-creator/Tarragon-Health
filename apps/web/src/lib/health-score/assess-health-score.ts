import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { computeHealthScore, type HealthScoreInputs } from "@/lib/rules/health-score";
import { fetchLatestBmi } from "@/lib/health-metrics/bmi";
import type { Database, Json } from "@tarragon/shared";

const BP_CONTROL_WINDOW_DAYS = 90;
const BP_CONTROL_SYSTOLIC_MAX = 140;
const BP_CONTROL_DIASTOLIC_MAX = 90;

async function fetchBpControlPercent(
  supabase: SupabaseClient<Database>,
  patientId: string
): Promise<number | null> {
  const since = new Date(Date.now() - BP_CONTROL_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("vitals_readings")
    .select("systolic, diastolic")
    .eq("patient_id", patientId)
    .eq("vital_type", "blood_pressure")
    .gte("taken_at", since);

  const readings = (data ?? []).filter((r) => r.systolic !== null && r.diastolic !== null);
  if (readings.length === 0) return null;

  const controlled = readings.filter(
    (r) => (r.systolic as number) < BP_CONTROL_SYSTOLIC_MAX && (r.diastolic as number) < BP_CONTROL_DIASTOLIC_MAX
  ).length;
  return Math.round((controlled / readings.length) * 100);
}

async function fetchLatestHba1c(
  supabase: SupabaseClient<Database>,
  patientId: string
): Promise<number | null> {
  const { data } = await supabase
    .from("lab_analyte_readings")
    .select("value")
    .eq("patient_id", patientId)
    .eq("code", "hba1c")
    .order("taken_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.value ?? null;
}

async function fetchScreeningCompliancePercent(
  supabase: SupabaseClient<Database>,
  patientId: string
): Promise<number | null> {
  const { data } = await supabase
    .from("screening_schedules")
    .select("status")
    .eq("patient_id", patientId)
    .in("status", ["completed", "overdue"]);

  const rows = data ?? [];
  if (rows.length === 0) return null;
  const completed = rows.filter((r) => r.status === "completed").length;
  return Math.round((completed / rows.length) * 100);
}


async function fetchVaccinationCompliancePercent(
  supabase: SupabaseClient<Database>,
  patientId: string
): Promise<number | null> {
  const { data } = await supabase
    .from("vaccination_schedules")
    .select("status")
    .eq("patient_id", patientId)
    .in("status", ["completed", "overdue"]);

  const rows = data ?? [];
  if (rows.length === 0) return null;
  const completed = rows.filter((r) => r.status === "completed").length;
  return Math.round((completed / rows.length) * 100);
}

async function fetchSmoking(
  supabase: SupabaseClient<Database>,
  patientId: string
): Promise<Pick<HealthScoreInputs, "smokingStatus" | "cigarettesPerDay">> {
  const { data } = await supabase
    .from("risk_assessment_responses")
    .select("question_key, response")
    .eq("profile_id", patientId)
    .in("question_key", ["smoking_status", "cigarettes_per_day"])
    .order("created_at", { ascending: false })
    .limit(10);

  // data is newest-first; only keep the first (newest) occurrence of each
  // key — a plain `new Map(data.map(...))` would let a later, older row for
  // the same key silently overwrite the newer one.
  const byKey = new Map<string, unknown>();
  for (const row of data ?? []) {
    if (!byKey.has(row.question_key)) byKey.set(row.question_key, row.response);
  }
  const smokingStatus = byKey.get("smoking_status");
  const cigarettesPerDay = byKey.get("cigarettes_per_day");

  return {
    smokingStatus: (smokingStatus as HealthScoreInputs["smokingStatus"]) ?? null,
    cigarettesPerDay: (cigarettesPerDay as HealthScoreInputs["cigarettesPerDay"]) ?? null,
  };
}

/**
 * Best-effort Health Score (re)computation — mirrors assessBpControlBestEffort's
 * never-throws, silent-no-op-on-missing-data contract. Called after events
 * that change one of the score's inputs (a vitals log, a risk assessment
 * submission) so the score stays fresh without a scheduled job. Takes the
 * caller's own RLS-scoped client for the reads (same reasoning as
 * assessBpControlBestEffort) but writes patient_risk_scores through the
 * service-role client, since that table is staff/system-write only.
 */
export async function assessHealthScoreBestEffort(
  supabase: SupabaseClient<Database>,
  patientId: string,
  organisationId: string
): Promise<void> {
  const [
    bpControlPercent,
    latestHba1cPercent,
    screeningCompliancePercent,
    vaccinationCompliancePercent,
    bmi,
    smoking,
  ] = await Promise.all([
    fetchBpControlPercent(supabase, patientId),
    fetchLatestHba1c(supabase, patientId),
    fetchScreeningCompliancePercent(supabase, patientId),
    fetchVaccinationCompliancePercent(supabase, patientId),
    fetchLatestBmi(supabase, patientId),
    fetchSmoking(supabase, patientId),
  ]);

  const result = computeHealthScore({
    bpControlPercent,
    latestHba1cPercent,
    screeningCompliancePercent,
    vaccinationCompliancePercent,
    bmi,
    ...smoking,
  });
  if (!result) return;

  await createServiceRoleClient()
    .from("patient_risk_scores")
    .insert({
      organisation_id: organisationId,
      patient_id: patientId,
      score_type: "health_score",
      score: result.score,
      risk_level: result.riskLevel,
      model_version: "health_score_rule_based_v2",
      inputs: { components: result.components } as unknown as Json,
    });
}
