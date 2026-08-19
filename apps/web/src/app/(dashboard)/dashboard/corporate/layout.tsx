import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { ContractStatusCard } from "@/components/contract-status-card";
import { InstitutionPrivacyNotice, CohortTooSmallNotice } from "@/components/institution-privacy-notice";
import { RosterManager } from "./roster-manager";
import { OutcomeReportsPanel } from "./outcome-reports-panel";
import { loadCorporateDashboardData } from "./dashboard-data";
import { CorporateNav } from "./corporate-nav";
import { CorporatePageHeader } from "./corporate-page-header";

/**
 * Every degraded state (no org, no verified access, cohort too small to
 * report on, ML service down) renders exactly as it did before this page was
 * split into tabs — none of those states have enough content to be a
 * stacking problem, so they're untouched. Only the fully-loaded state, which
 * used to stack all ~9 cards on one page, now gets a real Overview/Reports
 * tab split.
 */
export default async function CorporateLayout({ children }: { children: React.ReactNode }) {
  const data = await loadCorporateDashboardData();

  if (data.state === "no-org") {
    return (
      <DashboardPlaceholder
        greeting={data.greeting}
        roleLabel="Corporate admin"
        comingUp={["Staff enrolment", "Workforce health: cohort risk distribution"]}
      />
    );
  }

  if (data.state === "no-access") {
    return (
      <DashboardPlaceholder
        greeting={data.greeting}
        roleLabel="Corporate admin"
        comingUp={["Workforce health: cohort risk distribution"]}
      />
    );
  }

  const header = (
    <div>
      <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{data.greeting}</h1>
      <p className="text-charcoal-ink/60">Corporate admin dashboard</p>
    </div>
  );

  if (data.state === "suppressed") {
    return (
      <div className="space-y-6">
        {header}
        <InstitutionPrivacyNotice />
        <CohortTooSmallNotice cohortSize={data.access.cohortSize} minCohortSize={data.access.minCohortSize} />
        <RosterManager organisationId={data.organisationId} />
        <OutcomeReportsPanel organisationId={data.organisationId} />
      </div>
    );
  }

  if (data.state === "no-analytics") {
    return (
      <DashboardPlaceholder
        greeting={data.greeting}
        roleLabel="Corporate admin"
        comingUp={["Workforce health: cohort risk distribution (ML service unavailable)"]}
      >
        <div className="space-y-6">
          <InstitutionPrivacyNotice />
          <ContractStatusCard performance={data.contractPerformance} />
          <RosterManager organisationId={data.organisationId} />
          <OutcomeReportsPanel organisationId={data.organisationId} />
        </div>
      </DashboardPlaceholder>
    );
  }

  return (
    <div className="space-y-6">
      <CorporatePageHeader />
      <CorporateNav />
      {children}
    </div>
  );
}
