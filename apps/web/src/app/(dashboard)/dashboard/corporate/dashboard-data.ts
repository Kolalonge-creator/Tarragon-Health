import { cache } from "react";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getContractPerformance } from "@/lib/outcomes-contracts/get-contract-performance";
import { loadCohortAnalytics } from "@/lib/corporate/load-cohort-analytics";
import { requireInstitutionAggregateAccess } from "@/lib/institutions/aggregate-access";
import { loadAgeBandDistribution } from "@/lib/corporate/load-age-band-distribution";
import { loadMedicationOutcomes } from "@/lib/outcomes/medication-outcomes";
import { loadEngagementOutcomeCorrelation } from "@/lib/outcomes/engagement-outcome-correlation";
import { loadVaccinationCoverage } from "@/lib/vaccination/load-coverage-analytics";
import { loadActivationFunnel, loadDepartmentBreakdown } from "@/lib/corporate/load-activation-funnel";
import { failed, loadedValue, settleLoad } from "@/lib/institutions/settle-load";

/**
 * The corporate dashboard's single data-loading waterfall, extracted so the
 * layout (which decides whether there's even enough to show two tabs) and
 * each tab route can all resolve it once per request instead of three times
 * — cache() dedupes by call, so layout.tsx/page.tsx/reports/page.tsx calling
 * this independently (the standard Next.js "no prop-threading from layout to
 * page" pattern, same as /patient/dashboard-context.ts) still only hits
 * loadCohortAnalytics/the ML service once.
 */
async function loadCorporateDashboardDataUncached() {
  const profile = await getCurrentProfile();
  const greeting = `Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`;

  if (!profile?.organisation_id) {
    return { state: "no-org" as const, greeting };
  }

  // I9: a corporate admin's own session now reads zero rows from every
  // patient-scoped table, so the aggregates come through the one verified
  // server-side doorway instead. Roster management still runs on the
  // caller's own session — that table is the employer's own staff list.
  const access = await requireInstitutionAggregateAccess(profile.organisation_id, "corporate_dashboard");
  if (!access) {
    return { state: "no-access" as const, greeting };
  }

  const organisationId = profile.organisation_id;

  if (access.suppressed) {
    return { state: "suppressed" as const, greeting, organisationId, access };
  }

  // Each read settles on its own: a failed one costs its own card, not the page,
  // and is carried as `unavailable` so it is never mistaken for "nothing to show".
  const [analyticsRead, contractRead] = await Promise.all([
    settleLoad("corporate.cohort_analytics", () =>
      loadCohortAnalytics(access.client, access.organisationId, access.minCohortSize),
    ),
    settleLoad("corporate.contract_performance", () => getContractPerformance(access.client, access.organisationId)),
  ]);
  const analytics = loadedValue(analyticsRead);
  const contractPerformance = loadedValue(contractRead);

  // A failed analytics read lands here too: the copy there already says the
  // figures are unavailable rather than showing any.
  if (!analytics) {
    return {
      state: "no-analytics" as const,
      greeting,
      organisationId,
      access,
      contractPerformance,
      unavailable: { contract: failed(contractRead) },
    };
  }

  const [
    ageBandsRead,
    medicationRead,
    engagementRead,
    vaccinationRead,
    funnelRead,
    departmentsRead,
  ] = await Promise.all([
    settleLoad("corporate.age_bands", () => loadAgeBandDistribution(access.client, access.organisationId)),
    settleLoad("corporate.medication_outcomes", () => loadMedicationOutcomes(access.client, access.organisationId)),
    settleLoad("corporate.engagement_outcomes", () =>
      loadEngagementOutcomeCorrelation(access.client, access.organisationId, access.minCohortSize),
    ),
    settleLoad("corporate.vaccination_coverage", () =>
      loadVaccinationCoverage(access.client, access.organisationId, access.minCohortSize),
    ),
    settleLoad("corporate.activation_funnel", () =>
      loadActivationFunnel(access.client, access.organisationId, access.minCohortSize),
    ),
    settleLoad("corporate.department_breakdown", () =>
      loadDepartmentBreakdown(access.client, access.organisationId, access.minCohortSize),
    ),
  ]);

  return {
    state: "ready" as const,
    greeting,
    organisationId,
    access,
    analytics,
    contractPerformance,
    ageBands: loadedValue(ageBandsRead),
    medicationOutcomes: loadedValue(medicationRead),
    engagementOutcomes: loadedValue(engagementRead),
    vaccinationCoverage: loadedValue(vaccinationRead),
    activationFunnel: loadedValue(funnelRead),
    departmentBreakdown: loadedValue(departmentsRead) ?? [],
    unavailable: {
      contract: failed(contractRead),
      ageBands: failed(ageBandsRead),
      medicationOutcomes: failed(medicationRead),
      engagementOutcomes: failed(engagementRead),
      vaccinationCoverage: failed(vaccinationRead),
      activationFunnel: failed(funnelRead),
      departmentBreakdown: failed(departmentsRead),
    },
  };
}

export const loadCorporateDashboardData = cache(loadCorporateDashboardDataUncached);
export type CorporateDashboardData = Awaited<ReturnType<typeof loadCorporateDashboardData>>;
