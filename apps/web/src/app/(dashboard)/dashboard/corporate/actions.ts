"use server";

import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loadCohortAnalytics } from "@/lib/corporate/load-cohort-analytics";
import { getContractPerformance } from "@/lib/outcomes-contracts/get-contract-performance";
import { loadCareGaps } from "@/lib/care-gaps/load-care-gaps";
import { requireInstitutionAggregateAccess } from "@/lib/institutions/aggregate-access";
import { loadMedicationOutcomes } from "@/lib/outcomes/medication-outcomes";
import * as Sentry from "@sentry/nextjs";
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
  let access: Awaited<ReturnType<typeof requireInstitutionAggregateAccess>>;
  try {
    access = await requireInstitutionAggregateAccess(organisationId, "outcome_report_generate");
  } catch (err) {
    Sentry.captureException(err, { extra: { institutionLoad: "outcome_report.access" } });
    return { error: "We could not check your access just now, so nothing was saved. Please try again in a few minutes." };
  }
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

  // A saved report is frozen and quoted outside the platform, so a read that
  // failed must stop it being written. Snapshotting a zero here would put
  // "0 medicines stopped" or "no contract" into a document nobody can correct.
  const READ_FAILED = {
    error: "We could not read all of the figures for this report just now, so nothing was saved. Please try again in a few minutes.",
  };
  let analytics: Awaited<ReturnType<typeof loadCohortAnalytics>>;
  let contractPerformance: Awaited<ReturnType<typeof getContractPerformance>>;
  try {
    [analytics, contractPerformance] = await Promise.all([
      loadCohortAnalytics(reader, organisationId, minCohortSize),
      getContractPerformance(reader, organisationId),
    ]);
  } catch (err) {
    Sentry.captureException(err, { extra: { institutionLoad: "outcome_report.cohort_and_contract" } });
    return READ_FAILED;
  }

  if (!analytics) {
    return {
      error: `Not enough enrolled people yet to report safely (at least ${minCohortSize} are needed), or the analytics service is unavailable.`,
    };
  }

  let careGaps: Awaited<ReturnType<typeof loadCareGaps>>;
  let medicationOutcomes: Awaited<ReturnType<typeof loadMedicationOutcomes>>;
  try {
    [careGaps, medicationOutcomes] = await Promise.all([
      loadCareGaps(reader, organisationId, minCohortSize),
      // INV-10: medications are closed to direct staff reads, so a care-team session would silently count zero stops and the saved report
      // would record "no de-prescribing". The caller is already authorised for this organisation above (admin, or a non-patient of this
      // organisation); the loader returns counts only, filtered by that organisation, the same aggregate the institution dashboards use.
      loadMedicationOutcomes(access?.client ?? createServiceRoleClient(), organisationId),
    ]);
  } catch (err) {
    Sentry.captureException(err, { extra: { institutionLoad: "outcome_report.care_gaps_and_medication" } });
    return READ_FAILED;
  }

  const { error } = await supabase.from("outcome_reports").insert({
    organisation_id: organisationId,
    period_start: periodStart,
    period_end: periodEnd,
    snapshot: {
      analytics,
      contractPerformance,
      careGaps: careGaps
        ? { totalOpen: careGaps.totalOpen, byType: careGaps.byType, ledger: careGaps.ledger }
        : null,
      medicationOutcomes,
    } as unknown as Json,
    generated_by: profile.id,
  });
  if (error) {
    return { error: error.message };
  }

  return { message: "Report generated." };
}
