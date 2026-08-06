import { cache } from "react";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getContractPerformance } from "@/lib/outcomes-contracts/get-contract-performance";
import { loadCohortAnalytics } from "@/lib/corporate/load-cohort-analytics";
import { loadCareGaps } from "@/lib/care-gaps/load-care-gaps";
import { estimateCostAvoided } from "@/lib/care-gaps/estimate-cost-avoided";
import { requireInstitutionAggregateAccess } from "@/lib/institutions/aggregate-access";
import { loadMedicationOutcomes } from "@/lib/outcomes/medication-outcomes";

/** Same shape/reasoning as dashboard/corporate/dashboard-data.ts — see its
 * comment. HMO's waterfall additionally loads care gaps and always attempts
 * medication outcomes even before analytics is known, matching the original
 * single-page HmoPage exactly. */
async function loadHmoDashboardDataUncached() {
  const profile = await getCurrentProfile();
  const greeting = `Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`;

  if (!profile?.organisation_id) {
    return { state: "no-org" as const, greeting };
  }

  // I9: an HMO admin's own session now reads zero rows from every
  // patient-scoped table, so the aggregates come through the one verified
  // server-side doorway instead. Roster management still runs on the
  // caller's own session — that table is the HMO's own membership list.
  const access = await requireInstitutionAggregateAccess(profile.organisation_id);
  if (!access) {
    return { state: "no-access" as const, greeting };
  }

  const organisationId = profile.organisation_id;

  if (access.suppressed) {
    return { state: "suppressed" as const, greeting, organisationId, access };
  }

  const [analytics, contractPerformance, careGaps, medicationOutcomes] = await Promise.all([
    loadCohortAnalytics(access.client, access.organisationId, access.minCohortSize),
    getContractPerformance(access.client, access.organisationId),
    loadCareGaps(access.client, access.organisationId, access.minCohortSize),
    loadMedicationOutcomes(access.client, access.organisationId),
  ]);

  if (!analytics) {
    return {
      state: "no-analytics" as const,
      greeting,
      organisationId,
      access,
      contractPerformance,
      careGaps,
    };
  }

  const costAvoided = await estimateCostAvoided(
    access.client,
    access.organisationId,
    analytics.abnormal_findings_count
  );

  return {
    state: "ready" as const,
    greeting,
    organisationId,
    access,
    analytics,
    contractPerformance,
    careGaps,
    costAvoided,
    medicationOutcomes,
  };
}

export const loadHmoDashboardData = cache(loadHmoDashboardDataUncached);
export type HmoDashboardData = Awaited<ReturnType<typeof loadHmoDashboardData>>;
