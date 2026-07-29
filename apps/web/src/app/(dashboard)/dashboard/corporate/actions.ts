"use server";

import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { loadCohortAnalytics } from "@/lib/corporate/load-cohort-analytics";
import { getContractPerformance } from "@/lib/outcomes-contracts/get-contract-performance";
import { loadCareGaps } from "@/lib/care-gaps/load-care-gaps";
import { requireInstitutionAggregateAccess } from "@/lib/institutions/aggregate-access";
import { estimateCostAvoided } from "@/lib/care-gaps/estimate-cost-avoided";
import { loadMedicationOutcomes } from "@/lib/outcomes/medication-outcomes";
import type { Json } from "@tarragon/shared";

export type GenerateOutcomeReportState = { error?: string; message?: string } | undefined;

/**
 * Published, shareable outcome reports (docs/FULL_SPECIFICATION_V4.md
 * §2.4/§8 — a BD sales asset, the same anonymised numbers already on the
 * live dashboard, just frozen for a period so they can be quoted externally
 * without drifting). Server action (not a client mutation) because
 * loadCohortAnalytics needs createMlClientFromEnv(), which only resolves
 * server-side env vars.
 */
export async function generateOutcomeReport(
  _prevState: GenerateOutcomeReportState,
  formData: FormData
): Promise<GenerateOutcomeReportState> {
  const organisationId = String(formData.get("organisation_id") ?? "");
  const periodStart = String(formData.get("period_start") ?? "");
  const periodEnd = String(formData.get("period_end") ?? "");
  if (!organisationId || !periodStart || !periodEnd) {
    return { error: "Missing required fields" };
  }
  if (periodEnd < periodStart) {
    return { error: "End date must be on or after the start date" };
  }

  const profile = await getCurrentProfile();
  if (!profile || profile.role === "patient") {
    return { error: "Not authorised" };
  }
  if (profile.role !== "admin" && profile.organisation_id !== organisationId) {
    return { error: "Not authorised for this organisation" };
  }

  const supabase = await createClient();

  // I9: an institution admin reads zero rows from the patient-scoped tables
  // these loaders touch, so they assemble the snapshot through the verified
  // aggregate doorway. Care-team staff generating the same report keep using
  // their own session. Either way the suppression threshold is the same — the
  // report is an institution-facing artifact regardless of who pressed the
  // button, so it must not contain a figure the dashboard would withhold.
  const access = await requireInstitutionAggregateAccess(organisationId);
  const reader = access?.client ?? supabase;

  let minCohortSize = access?.minCohortSize;
  if (minCohortSize === undefined) {
    const { data: org } = await supabase
      .from("organisations")
      .select("min_cohort_size")
      .eq("id", organisationId)
      .single();
    minCohortSize = org?.min_cohort_size ?? 10;
  }

  const [analytics, contractPerformance] = await Promise.all([
    loadCohortAnalytics(reader, organisationId, minCohortSize),
    getContractPerformance(reader, organisationId),
  ]);

  if (!analytics) {
    return {
      error: `Not enough enrolled people yet to report safely (at least ${minCohortSize} are needed), or the analytics service is unavailable.`,
    };
  }

  const [careGaps, costAvoided, medicationOutcomes] = await Promise.all([
    loadCareGaps(reader, organisationId, minCohortSize),
    estimateCostAvoided(reader, organisationId, analytics.abnormal_findings_count),
    loadMedicationOutcomes(reader, organisationId),
  ]);

  const { error } = await supabase.from("outcome_reports").insert({
    organisation_id: organisationId,
    period_start: periodStart,
    period_end: periodEnd,
    snapshot: {
      analytics,
      contractPerformance,
      careGaps: careGaps
        ? { totalOpen: careGaps.totalOpen, byType: careGaps.byType, closedLast90Days: careGaps.closedLast90Days }
        : null,
      costAvoided,
      medicationOutcomes,
    } as unknown as Json,
    generated_by: profile.id,
  });
  if (error) {
    return { error: error.message };
  }

  return { message: "Report generated." };
}
