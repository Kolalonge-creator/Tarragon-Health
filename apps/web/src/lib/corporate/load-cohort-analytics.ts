import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import {
  ageFromDateOfBirth,
  createMlClientFromEnv,
  type CohortAnalyticsResponse,
  type CohortChronicCondition,
  type CohortMemberIn,
} from "@tarragon/shared";

const COHORT_CHRONIC_CONDITIONS: readonly CohortChronicCondition[] = ["hypertension", "diabetes"];

/**
 * Extracted from the corporate dashboard page so it can be reused by the
 * outcome-report snapshot generator (apps/web/src/app/(dashboard)/dashboard/corporate/actions.ts)
 * without duplicating the anonymised-cohort-assembly logic. Returns null if
 * the org has no enrolled patients (or the ML service is unavailable).
 */
export async function loadCohortAnalytics(
  supabase: SupabaseClient<Database>,
  organisationId: string
): Promise<CohortAnalyticsResponse | null> {
  const { data: patients } = await supabase
    .from("profiles")
    .select("id, sex, date_of_birth")
    .eq("organisation_id", organisationId)
    .eq("role", "patient");
  if (!patients || patients.length === 0) return null;

  const patientIds = patients.map((p) => p.id);
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: riskScores }, { data: carePlans }, { data: schedules }, { data: screeningResults }] =
    await Promise.all([
      supabase
        .from("patient_risk_scores")
        .select("patient_id, score_type, score, risk_level, inputs, computed_at")
        .in("patient_id", patientIds)
        .order("computed_at", { ascending: false }),
      supabase
        .from("care_plans")
        .select("patient_id, condition")
        .in("patient_id", patientIds)
        .eq("status", "active"),
      supabase
        .from("screening_schedules")
        .select("patient_id, due_date, status")
        .in("patient_id", patientIds)
        .in("status", ["pending", "booked"]),
      supabase
        .from("screening_results")
        .select("patient_id, abnormal_flags, result_status")
        .in("patient_id", patientIds)
        .in("result_status", ["abnormal", "critical"]),
    ]);

  const latestCvdByPatient = new Map<string, { score: number; risk_level: string }>();
  const latestBpControlByPatient = new Map<string, number>();
  const latestHba1cTrendByPatient = new Map<string, string>();
  for (const row of riskScores ?? []) {
    if (row.score_type === "cvd_10yr" && !latestCvdByPatient.has(row.patient_id) && row.score !== null) {
      latestCvdByPatient.set(row.patient_id, { score: row.score, risk_level: row.risk_level ?? "low" });
    }
    if (row.score_type === "bp_control" && !latestBpControlByPatient.has(row.patient_id) && row.score !== null) {
      latestBpControlByPatient.set(row.patient_id, row.score);
    }
    if (row.score_type === "hba1c_trajectory" && !latestHba1cTrendByPatient.has(row.patient_id)) {
      const trend = (row.inputs as { trend?: string } | null)?.trend;
      if (trend) latestHba1cTrendByPatient.set(row.patient_id, trend);
    }
  }

  const conditionsByPatient = new Map<string, Set<CohortChronicCondition>>();
  for (const row of carePlans ?? []) {
    if (!COHORT_CHRONIC_CONDITIONS.includes(row.condition as CohortChronicCondition)) continue;
    const set = conditionsByPatient.get(row.patient_id) ?? new Set();
    set.add(row.condition as CohortChronicCondition);
    conditionsByPatient.set(row.patient_id, set);
  }

  const overdueCountByPatient = new Map<string, number>();
  for (const row of schedules ?? []) {
    if (row.due_date >= today) continue;
    overdueCountByPatient.set(row.patient_id, (overdueCountByPatient.get(row.patient_id) ?? 0) + 1);
  }

  const flagsByPatient = new Map<string, Set<string>>();
  for (const row of screeningResults ?? []) {
    const set = flagsByPatient.get(row.patient_id) ?? new Set<string>();
    for (const flag of row.abnormal_flags) set.add(flag);
    flagsByPatient.set(row.patient_id, set);
  }

  const members: CohortMemberIn[] = patients
    .filter((p) => p.sex && p.date_of_birth)
    .map((p) => ({
      age: ageFromDateOfBirth(p.date_of_birth) ?? 0,
      sex: p.sex!,
      chronic_conditions: [...(conditionsByPatient.get(p.id) ?? [])],
      cvd_risk_10yr_percent: latestCvdByPatient.get(p.id)?.score ?? null,
      cvd_risk_level: (latestCvdByPatient.get(p.id)?.risk_level as CohortMemberIn["cvd_risk_level"]) ?? null,
      hba1c_trend: (latestHba1cTrendByPatient.get(p.id) as CohortMemberIn["hba1c_trend"]) ?? null,
      bp_control_rate_percent: latestBpControlByPatient.get(p.id) ?? null,
      screening_overdue_count: overdueCountByPatient.get(p.id) ?? 0,
      abnormal_flags: [...(flagsByPatient.get(p.id) ?? [])],
    }));
  if (members.length === 0) return null;

  const mlClient = createMlClientFromEnv();
  if (!mlClient) return null;

  return mlClient.analyseCohort({ members });
}
