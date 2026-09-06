import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { isCohortSuppressed } from "@/lib/institutions/suppression";

export type EngagementOutcomeBucket = {
  tier: Database["public"]["Enums"]["patient_engagement_tier"];
  /** Patients in this tier who are also BP-monitored (have a bp_control score). */
  cohortSize: number;
  /** Of those, patients whose LATEST bp_control assessment is in range (low risk). */
  bpInRangeCount: number;
  /** True when cohortSize is below the org's small-cell floor — never render a figure. */
  suppressed: boolean;
};

/**
 * Does engagement actually correlate with a clinical outcome, or is the
 * platform only proving it can measure app activity? Joins
 * patient_engagement_scores (Engagement/Retention gap #2) against the same
 * bp_control risk scores loadMedicationOutcomes already reads, latest per
 * patient on each side. A patient with no bp_control score at all is
 * excluded from every bucket — same honesty rule as
 * loadMedicationOutcomes's bpMonitoredCount, an unmonitored patient proves
 * nothing about control either way. Suppression is applied PER TIER, not
 * once for the whole org: an org can clear the dashboard's overall
 * min-cohort-size gate while still having only a handful of people in
 * highly_engaged.
 */
export async function loadEngagementOutcomeCorrelation(
  supabase: SupabaseClient<Database>,
  organisationId: string,
  minCohortSize: number
): Promise<EngagementOutcomeBucket[] | null> {
  const [scores, bpScores] = await Promise.all([
    supabase
      .from("patient_engagement_scores")
      .select("patient_id, tier, computed_at")
      .eq("organisation_id", organisationId)
      .order("computed_at", { ascending: false }),
    supabase
      .from("patient_risk_scores")
      .select("patient_id, risk_level, computed_at")
      .eq("organisation_id", organisationId)
      .eq("score_type", "bp_control")
      .order("computed_at", { ascending: false }),
  ]);

  if (scores.error || bpScores.error) return null;

  const latestTierByPatient = new Map<string, Database["public"]["Enums"]["patient_engagement_tier"]>();
  for (const row of scores.data ?? []) {
    if (!latestTierByPatient.has(row.patient_id)) {
      latestTierByPatient.set(row.patient_id, row.tier);
    }
  }

  const latestBpLevelByPatient = new Map<string, string | null>();
  for (const row of bpScores.data ?? []) {
    if (!latestBpLevelByPatient.has(row.patient_id)) {
      latestBpLevelByPatient.set(row.patient_id, row.risk_level);
    }
  }

  const buckets = new Map<
    Database["public"]["Enums"]["patient_engagement_tier"],
    { cohortSize: number; bpInRangeCount: number }
  >();
  for (const [patientId, tier] of latestTierByPatient) {
    const bpLevel = latestBpLevelByPatient.get(patientId);
    if (bpLevel === undefined) continue;
    const bucket = buckets.get(tier) ?? { cohortSize: 0, bpInRangeCount: 0 };
    bucket.cohortSize += 1;
    if (bpLevel === "low") bucket.bpInRangeCount += 1;
    buckets.set(tier, bucket);
  }

  return Array.from(buckets.entries()).map(([tier, bucket]) => ({
    tier,
    cohortSize: bucket.cohortSize,
    bpInRangeCount: bucket.bpInRangeCount,
    suppressed: isCohortSuppressed(bucket.cohortSize, minCohortSize),
  }));
}
