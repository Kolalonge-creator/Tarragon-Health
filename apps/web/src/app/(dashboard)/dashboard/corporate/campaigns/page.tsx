import { loadCorporateDashboardData } from "../dashboard-data";
import { CampaignsAnnouncementsManager } from "../campaigns-announcements-manager";

/** Only ever rendered once corporate/layout.tsx has established an
 * organisation exists. Campaigns/announcements need only `organisationId` —
 * never the cohort-sized ML analytics "ready" gates — so this renders in
 * "suppressed" and "no-analytics" too, not just "ready". */
export default async function CorporateCampaignsPage() {
  const data = await loadCorporateDashboardData();
  if (data.state === "no-org" || data.state === "no-access") {
    return null;
  }

  return <CampaignsAnnouncementsManager organisationId={data.organisationId} />;
}
