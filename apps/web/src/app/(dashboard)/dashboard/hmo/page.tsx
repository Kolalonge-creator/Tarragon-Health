import { InstitutionPrivacyNotice } from "@/components/institution-privacy-notice";
import { ContractStatusCard } from "@/components/contract-status-card";
import { RosterManager } from "../corporate/roster-manager";
import { CohortSummary } from "../corporate/cohort-summary";
import { CareGapPanel } from "./care-gap-panel";
import { loadHmoDashboardData } from "./dashboard-data";

/** Only ever rendered when hmo/layout.tsx has already established the
 * "ready" state (every other data state short-circuits in the layout
 * without rendering `children` at all, so this never mounts for those). */
export default async function HmoOverviewPage() {
  const data = await loadHmoDashboardData();
  if (data.state !== "ready") {
    return null;
  }

  return (
    <div className="space-y-6">
      <InstitutionPrivacyNotice entityLabel="member" />
      <ContractStatusCard performance={data.contractPerformance} />
      <RosterManager organisationId={data.organisationId} entityLabel="member" />
      <CohortSummary analytics={data.analytics} />
      <CareGapPanel summary={data.careGaps} />
    </div>
  );
}
