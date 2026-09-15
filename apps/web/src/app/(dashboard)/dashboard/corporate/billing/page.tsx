import { loadCorporateDashboardData } from "../dashboard-data";
import { EmployerBillingPanel } from "../employer-billing-panel";

/** Only ever rendered once corporate/layout.tsx has established an
 * organisation exists. Contract/invoice data needs only `organisationId` —
 * never the cohort-sized ML analytics "ready" gates — so this renders in
 * "suppressed" and "no-analytics" too, not just "ready". */
export default async function CorporateBillingPage() {
  const data = await loadCorporateDashboardData();
  if (data.state === "no-org" || data.state === "no-access") {
    return null;
  }

  return <EmployerBillingPanel organisationId={data.organisationId} />;
}
