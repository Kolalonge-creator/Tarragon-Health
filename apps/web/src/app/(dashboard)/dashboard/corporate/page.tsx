import { InstitutionPrivacyNotice } from "@/components/institution-privacy-notice";
import { ContractStatusCard } from "@/components/contract-status-card";
import { RosterManager } from "./roster-manager";
import { CohortSummary } from "./cohort-summary";
import { ActivationFunnelCard, DepartmentBreakdownTable } from "./activation-funnel-card";
import { loadCorporateDashboardData } from "./dashboard-data";

/** Only ever rendered when corporate/layout.tsx has already established the
 * "ready" state (every other data state short-circuits in the layout without
 * rendering `children` at all, so this never mounts for those). */
export default async function CorporateOverviewPage() {
  const data = await loadCorporateDashboardData();
  if (data.state !== "ready") {
    return null;
  }

  return (
    <div className="space-y-6">
      <InstitutionPrivacyNotice />
      <ContractStatusCard performance={data.contractPerformance} />
      <ActivationFunnelCard funnel={data.activationFunnel} />
      <DepartmentBreakdownTable rows={data.departmentBreakdown} />
      <RosterManager organisationId={data.organisationId} />
      <CohortSummary analytics={data.analytics} />
    </div>
  );
}
