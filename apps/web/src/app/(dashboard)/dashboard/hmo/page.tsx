import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { ContractStatusCard } from "@/components/contract-status-card";
import { getContractPerformance } from "@/lib/outcomes-contracts/get-contract-performance";
import { loadCohortAnalytics } from "@/lib/corporate/load-cohort-analytics";
import { loadCareGaps } from "@/lib/care-gaps/load-care-gaps";
import { estimateCostAvoided } from "@/lib/care-gaps/estimate-cost-avoided";
import { RosterManager } from "../corporate/roster-manager";
import { OutcomeReportsPanel } from "../corporate/outcome-reports-panel";
import { CohortSummary } from "../corporate/cohort-summary";
import { CareGapPanel } from "./care-gap-panel";
import { ClaimsImpactCard } from "./claims-impact-card";
import { LifestyleOutcomesCard } from "@/components/lifestyle-outcomes-card";

export default async function HmoPage() {
  const profile = await getCurrentProfile();
  const greeting = `Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`;

  if (!profile?.organisation_id) {
    return (
      <DashboardPlaceholder
        greeting={greeting}
        roleLabel="HMO admin"
        comingUp={["Member enrolment", "Member population risk distribution"]}
      />
    );
  }

  const supabase = await createClient();
  const [analytics, contractPerformance, careGaps] = await Promise.all([
    loadCohortAnalytics(supabase, profile.organisation_id),
    getContractPerformance(supabase, profile.organisation_id),
    loadCareGaps(supabase, profile.organisation_id),
  ]);

  const costAvoided = analytics
    ? await estimateCostAvoided(supabase, profile.organisation_id, analytics.abnormal_findings_count)
    : null;

  if (!analytics) {
    return (
      <DashboardPlaceholder
        greeting={greeting}
        roleLabel="HMO admin"
        comingUp={[
          "Member population risk distribution (no members enrolled yet, or ML service unavailable)",
        ]}
      >
        <div className="space-y-6">
          <ContractStatusCard performance={contractPerformance} />
          <RosterManager organisationId={profile.organisation_id} entityLabel="member" />
          <CareGapPanel summary={careGaps} />
          <OutcomeReportsPanel organisationId={profile.organisation_id} />
        </div>
      </DashboardPlaceholder>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{greeting}</h1>
        <p className="text-charcoal-ink/60">HMO admin dashboard</p>
      </div>
      <ContractStatusCard performance={contractPerformance} />
      <RosterManager organisationId={profile.organisation_id} entityLabel="member" />
      <CohortSummary analytics={analytics} />
      <CareGapPanel summary={careGaps} />
      <ClaimsImpactCard estimate={costAvoided} />
      <LifestyleOutcomesCard organisationId={profile.organisation_id} />
      <OutcomeReportsPanel organisationId={profile.organisation_id} />
    </div>
  );
}
