import { cache } from "react";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getContractPerformance } from "@/lib/outcomes-contracts/get-contract-performance";
import { loadCohortAnalytics } from "@/lib/corporate/load-cohort-analytics";
import { loadCareGaps } from "@/lib/care-gaps/load-care-gaps";
import { requireInstitutionAggregateAccess } from "@/lib/institutions/aggregate-access";
import { loadMedicationOutcomes } from "@/lib/outcomes/medication-outcomes";
import { loadEngagementOutcomeCorrelation } from "@/lib/outcomes/engagement-outcome-correlation";
import { loadVaccinationCoverage } from "@/lib/vaccination/load-coverage-analytics";
import { failed, loadedValue, settleLoad } from "@/lib/institutions/settle-load";

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
  const access = await requireInstitutionAggregateAccess(profile.organisation_id, "hmo_dashboard");
  if (!access) {
    return { state: "no-access" as const, greeting };
  }

  const organisationId = profile.organisation_id;

  if (access.suppressed) {
    return { state: "suppressed" as const, greeting, organisationId, access };
  }

  // Each read settles on its own: a failed one costs its own card, not the page,
  // and is carried as `unavailable` so it is never mistaken for "nothing to show".
  const [
    analyticsRead,
    contractRead,
    careGapsRead,
    medicationRead,
    engagementRead,
    vaccinationRead,
  ] = await Promise.all([
    settleLoad("hmo.cohort_analytics", () =>
      loadCohortAnalytics(access.client, access.organisationId, access.minCohortSize),
    ),
    settleLoad("hmo.contract_performance", () => getContractPerformance(access.client, access.organisationId)),
    settleLoad("hmo.care_gaps", () => loadCareGaps(access.client, access.organisationId, access.minCohortSize)),
    settleLoad("hmo.medication_outcomes", () => loadMedicationOutcomes(access.client, access.organisationId)),
    settleLoad("hmo.engagement_outcomes", () =>
      loadEngagementOutcomeCorrelation(access.client, access.organisationId, access.minCohortSize),
    ),
    settleLoad("hmo.vaccination_coverage", () =>
      loadVaccinationCoverage(access.client, access.organisationId, access.minCohortSize),
    ),
  ]);
  const analytics = loadedValue(analyticsRead);
  const unavailable = {
    contract: failed(contractRead),
    careGaps: failed(careGapsRead),
    medicationOutcomes: failed(medicationRead),
    engagementOutcomes: failed(engagementRead),
    vaccinationCoverage: failed(vaccinationRead),
  };

  // A failed analytics read lands here too: the copy there already says the
  // figures are unavailable rather than showing any.
  if (!analytics) {
    return {
      state: "no-analytics" as const,
      greeting,
      organisationId,
      access,
      contractPerformance: loadedValue(contractRead),
      careGaps: loadedValue(careGapsRead),
      vaccinationCoverage: loadedValue(vaccinationRead),
      unavailable,
    };
  }

  return {
    state: "ready" as const,
    greeting,
    organisationId,
    access,
    analytics,
    contractPerformance: loadedValue(contractRead),
    careGaps: loadedValue(careGapsRead),
    medicationOutcomes: loadedValue(medicationRead),
    engagementOutcomes: loadedValue(engagementRead),
    vaccinationCoverage: loadedValue(vaccinationRead),
    unavailable,
  };
}

export const loadHmoDashboardData = cache(loadHmoDashboardDataUncached);
export type HmoDashboardData = Awaited<ReturnType<typeof loadHmoDashboardData>>;
