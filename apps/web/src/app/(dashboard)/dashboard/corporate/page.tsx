import { InstitutionPrivacyNotice, CohortTooSmallNotice } from "@/components/institution-privacy-notice";
import { ContractStatusCard } from "@/components/contract-status-card";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RosterManager } from "./roster-manager";
import { CohortSummary } from "./cohort-summary";
import { ActivationFunnelCard, DepartmentBreakdownTable } from "./activation-funnel-card";
import { loadCorporateDashboardData } from "./dashboard-data";

/** Only ever rendered when corporate/layout.tsx has already established an
 * organisation exists ("no-org"/"no-access" short-circuit in the layout
 * itself) — every remaining state is handled explicitly below, since roster
 * management (the one thing every employer needs from day one) must not be
 * gated behind a cohort large enough for the ML-driven analytics. */
export default async function CorporateOverviewPage() {
  const data = await loadCorporateDashboardData();
  if (data.state === "no-org" || data.state === "no-access") {
    return null;
  }

  if (data.state === "suppressed") {
    return (
      <div className="space-y-6">
        <InstitutionPrivacyNotice />
        <CohortTooSmallNotice cohortSize={data.access.cohortSize} minCohortSize={data.access.minCohortSize} />
        <RosterManager organisationId={data.organisationId} />
      </div>
    );
  }

  if (data.state === "no-analytics") {
    return (
      <div className="space-y-6">
        <InstitutionPrivacyNotice />
        <Card variant="soft">
          <CardHeader>
            <CardTitle>Workforce health analytics unavailable</CardTitle>
            <CardDescription>
              The analytics service is temporarily unavailable. Roster and contract information below are
              unaffected.
            </CardDescription>
          </CardHeader>
        </Card>
        <ContractStatusCard performance={data.contractPerformance} />
        <RosterManager organisationId={data.organisationId} />
      </div>
    );
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
