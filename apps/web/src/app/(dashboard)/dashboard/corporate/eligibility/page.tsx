import { loadCorporateDashboardData } from "../dashboard-data";
import { EligibilityBenefitsManager } from "../eligibility-benefits-manager";

/** Only ever rendered when corporate/layout.tsx has already established the
 * "ready" state — see page.tsx's own note. */
export default async function CorporateEligibilityPage() {
  const data = await loadCorporateDashboardData();
  if (data.state !== "ready") {
    return null;
  }

  return <EligibilityBenefitsManager organisationId={data.organisationId} />;
}
