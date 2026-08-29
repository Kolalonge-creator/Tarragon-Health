import { loadCorporateDashboardData } from "../dashboard-data";
import { EligibilityBenefitsManager } from "../eligibility-benefits-manager";

/** Only ever rendered once corporate/layout.tsx has established an
 * organisation exists. Eligibility/benefit-package management needs only
 * `organisationId` — never the cohort-sized ML analytics "ready" gates — so
 * this renders in "suppressed" and "no-analytics" too, not just "ready". */
export default async function CorporateEligibilityPage() {
  const data = await loadCorporateDashboardData();
  if (data.state === "no-org" || data.state === "no-access") {
    return null;
  }

  return <EligibilityBenefitsManager organisationId={data.organisationId} />;
}
