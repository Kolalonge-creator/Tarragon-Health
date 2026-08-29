import { loadCorporateDashboardData } from "../dashboard-data";
import { CampaignsAnnouncementsManager } from "../campaigns-announcements-manager";

/** Only ever rendered when corporate/layout.tsx has already established the
 * "ready" state — see page.tsx's own note. */
export default async function CorporateCampaignsPage() {
  const data = await loadCorporateDashboardData();
  if (data.state !== "ready") {
    return null;
  }

  return <CampaignsAnnouncementsManager organisationId={data.organisationId} />;
}
