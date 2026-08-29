import { loadCorporateDashboardData } from "../dashboard-data";
import { EmployerBillingPanel } from "../employer-billing-panel";

/** Only ever rendered when corporate/layout.tsx has already established the
 * "ready" state — see page.tsx's own note. */
export default async function CorporateBillingPage() {
  const data = await loadCorporateDashboardData();
  if (data.state !== "ready") {
    return null;
  }

  return <EmployerBillingPanel organisationId={data.organisationId} />;
}
