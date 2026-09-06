import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export type WellbeingCohortMetric = {
  respondedCount: number;
  totalCount: number;
  /** severity_band -> percent of respondents, rounded, never a raw score. */
  phq9: Record<string, number>;
  gad7: Record<string, number>;
} | null;

/**
 * Module 46 §46.14 workplace wellbeing: an aggregate-only, cohort-level
 * distribution of the most recent PHQ-9/GAD-7 severity band across the
 * organisation's patients — percentages only, never a raw score, never
 * attributable to an individual. Only ever called from
 * dashboard-data.ts's "ready" branch, i.e. after loadCohortAnalytics has
 * already confirmed the cohort clears organisations.min_cohort_size (I9) —
 * same suppression-already-happened-upstream pattern as
 * loadAgeBandDistribution/estimateCostAvoided/loadMedicationOutcomes, not a
 * second independent gate.
 */
export async function loadWellbeingCohortMetric(
  supabase: SupabaseClient<Database>,
  organisationId: string
): Promise<WellbeingCohortMetric> {
  const { data: patients } = await supabase
    .from("profiles")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("role", "patient");
  if (!patients || patients.length === 0) return null;
  const patientIds = patients.map((p) => p.id);

  const { data: screens } = await supabase
    .from("mental_health_screens")
    .select("patient_id, instrument, severity_band, created_at")
    .in("patient_id", patientIds)
    .in("instrument", ["phq9", "gad7"])
    .order("created_at", { ascending: false });
  if (!screens || screens.length === 0) return null;

  const latestBandByKey = new Map<string, string>();
  for (const row of screens) {
    const key = `${row.patient_id}:${row.instrument}`;
    if (!latestBandByKey.has(key)) {
      latestBandByKey.set(key, row.severity_band);
    }
  }

  function distribution(instrument: "phq9" | "gad7"): Record<string, number> {
    const counts: Record<string, number> = {};
    let total = 0;
    for (const [key, band] of latestBandByKey) {
      if (!key.endsWith(`:${instrument}`)) continue;
      counts[band] = (counts[band] ?? 0) + 1;
      total += 1;
    }
    if (total === 0) return {};
    const percentages: Record<string, number> = {};
    for (const [band, count] of Object.entries(counts)) {
      percentages[band] = Math.round((count / total) * 100);
    }
    return percentages;
  }

  const respondedCount = new Set([...latestBandByKey.keys()].map((key) => key.split(":")[0])).size;

  return {
    respondedCount,
    totalCount: patients.length,
    phq9: distribution("phq9"),
    gad7: distribution("gad7"),
  };
}
