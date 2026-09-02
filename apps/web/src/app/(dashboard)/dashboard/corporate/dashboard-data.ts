import { cache } from "react";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getContractPerformance } from "@/lib/outcomes-contracts/get-contract-performance";
import { loadCohortAnalytics } from "@/lib/corporate/load-cohort-analytics";
import { requireInstitutionAggregateAccess } from "@/lib/institutions/aggregate-access";
import { loadAgeBandDistribution } from "@/lib/corporate/load-age-band-distribution";
import { estimateCostAvoided } from "@/lib/care-gaps/estimate-cost-avoided";
import { loadMedicationOutcomes } from "@/lib/outcomes/medication-outcomes";
import { loadVaccinationCoverage } from "@/lib/vaccination/load-coverage-analytics";
import { loadWellbeingCohortMetric } from "@/lib/corporate/load-wellbeing-cohort-metric";
import { loadActivationFunnel, loadDepartmentBreakdown } from "@/lib/corporate/load-activation-funnel";

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
  const access = await requireInstitutionAggregateAccess(profile.organisation_id);
  if (!access) {
    return { state: "no-access" as const, greeting };
  }

  const organisationId = profile.organisation_id;

  if (access.suppressed) {
    return { state: "suppressed" as const, greeting, organisationId, access };
  }

  const [analytics, contractPerformance] = await Promise.all([
    loadCohortAnalytics(access.client, access.organisationId, access.minCohortSize),
    getContractPerformance(access.client, access.organisationId),
  ]);

  if (!analytics) {
    return { state: "no-analytics" as const, greeting, organisationId, access, contractPerformance };
  }

  const [
    ageBands,
    costAvoided,
    medicationOutcomes,
    vaccinationCoverage,
    wellbeingCohortMetric,
    activationFunnel,
    departmentBreakdown,
  ] = await Promise.all([
    loadAgeBandDistribution(access.client, access.organisationId),
    estimateCostAvoided(access.client, access.organisationId, analytics.abnormal_findings_count),
    loadMedicationOutcomes(access.client, access.organisationId),
    loadVaccinationCoverage(access.client, access.organisationId, access.minCohortSize),
    loadWellbeingCohortMetric(access.client, access.organisationId),
    loadActivationFunnel(access.client, access.organisationId, access.minCohortSize),
    loadDepartmentBreakdown(access.client, access.organisationId, access.minCohortSize),
  ]);

  return {
    state: "ready" as const,
    greeting,
    organisationId,
    access,
    analytics,
    contractPerformance,
    ageBands,
    costAvoided,
    medicationOutcomes,
    vaccinationCoverage,
    wellbeingCohortMetric,
    activationFunnel,
    departmentBreakdown,
  };
}

export const loadCorporateDashboardData = cache(loadCorporateDashboardDataUncached);
export type CorporateDashboardData = Awaited<ReturnType<typeof loadCorporateDashboardData>>;
