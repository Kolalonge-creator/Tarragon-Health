import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { ContractStatusCard } from "@/components/contract-status-card";
import { InstitutionPrivacyNotice, CohortTooSmallNotice } from "@/components/institution-privacy-notice";
import { RosterManager } from "../corporate/roster-manager";
import { OutcomeReportsPanel } from "../corporate/outcome-reports-panel";
import { CareGapPanel } from "./care-gap-panel";
import { loadHmoDashboardData } from "./dashboard-data";
import { HmoNav } from "./hmo-nav";
import { HmoPageHeader } from "./hmo-page-header";

/** Same reasoning as dashboard/corporate/layout.tsx — every degraded state
 * renders exactly as it did before the tab split; only the fully-loaded
 * state (which used to stack all ~9 cards on one page) gets real tabs. */
export default async function HmoLayout({ children }: { children: React.ReactNode }) {
  const data = await loadHmoDashboardData();

  if (data.state === "no-org") {
    return (
      <DashboardPlaceholder
        greeting={data.greeting}
        roleLabel="HMO admin"
        comingUp={["Member enrolment", "Member population risk distribution"]}
      />
    );
  }

  if (data.state === "no-access") {
    return (
      <DashboardPlaceholder
        greeting={data.greeting}
        roleLabel="HMO admin"
        comingUp={["Member population risk distribution"]}
      />
    );
  }

  const header = (
    <div>
      <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{data.greeting}</h1>
      <p className="text-charcoal-ink/60">HMO admin dashboard</p>
    </div>
  );

  if (data.state === "suppressed") {
    return (
      <div className="space-y-6">
        {header}
        <InstitutionPrivacyNotice entityLabel="member" />
        <CohortTooSmallNotice
          cohortSize={data.access.cohortSize}
          minCohortSize={data.access.minCohortSize}
          entityLabel="member"
        />
        <RosterManager organisationId={data.organisationId} entityLabel="member" />
        <OutcomeReportsPanel organisationId={data.organisationId} />
      </div>
    );
  }

  if (data.state === "no-analytics") {
    return (
      <DashboardPlaceholder
        greeting={data.greeting}
        roleLabel="HMO admin"
        comingUp={["Member population risk distribution (ML service unavailable)"]}
      >
        <div className="space-y-6">
          <InstitutionPrivacyNotice entityLabel="member" />
          <ContractStatusCard performance={data.contractPerformance} />
          <RosterManager organisationId={data.organisationId} entityLabel="member" />
          <CareGapPanel summary={data.careGaps} />
          <OutcomeReportsPanel organisationId={data.organisationId} />
        </div>
      </DashboardPlaceholder>
    );
  }

  return (
    <div className="space-y-6">
      <HmoPageHeader />
      <HmoNav />
      {children}
    </div>
  );
}
