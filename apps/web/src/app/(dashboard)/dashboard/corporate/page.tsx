import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { ContractStatusCard } from "@/components/contract-status-card";
import { getContractPerformance } from "@/lib/outcomes-contracts/get-contract-performance";
import { loadCohortAnalytics } from "@/lib/corporate/load-cohort-analytics";
import { RosterManager } from "./roster-manager";
import { OutcomeReportsPanel } from "./outcome-reports-panel";
import { CohortSummary } from "./cohort-summary";
import { AgeBandSummary } from "./age-band-summary";
import { OutcomeEvidenceSummary } from "./outcome-evidence-summary";
import { loadAgeBandDistribution } from "@/lib/corporate/load-age-band-distribution";
import { estimateCostAvoided } from "@/lib/care-gaps/estimate-cost-avoided";

export default async function CorporatePage() {
  const profile = await getCurrentProfile();
  const greeting = `Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`;

  if (!profile?.organisation_id) {
    return (
      <DashboardPlaceholder
        greeting={greeting}
        roleLabel="Corporate admin"
        comingUp={["Staff enrolment", "Workforce health — cohort risk distribution"]}
      />
    );
  }

  const supabase = await createClient();
  const [analytics, contractPerformance] = await Promise.all([
    loadCohortAnalytics(supabase, profile.organisation_id),
    getContractPerformance(supabase, profile.organisation_id),
  ]);

  if (!analytics) {
    return (
      <DashboardPlaceholder
        greeting={greeting}
        roleLabel="Corporate admin"
        comingUp={[
          "Workforce health — cohort risk distribution (no staff enrolled yet, or ML service unavailable)",
        ]}
      >
        <div className="space-y-6">
          <ContractStatusCard performance={contractPerformance} />
          <RosterManager organisationId={profile.organisation_id} />
          <OutcomeReportsPanel organisationId={profile.organisation_id} />
        </div>
      </DashboardPlaceholder>
    );
  }

  const [ageBands, costAvoided] = await Promise.all([
    loadAgeBandDistribution(supabase, profile.organisation_id),
    estimateCostAvoided(supabase, profile.organisation_id, analytics.abnormal_findings_count),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{greeting}</h1>
        <p className="text-charcoal-ink/60">Corporate admin dashboard</p>
      </div>
      <ContractStatusCard performance={contractPerformance} />
      <RosterManager organisationId={profile.organisation_id} />
      <CohortSummary analytics={analytics} />
      <AgeBandSummary distribution={ageBands} />
      <OutcomeEvidenceSummary organisationId={profile.organisation_id} costAvoided={costAvoided} />
      <OutcomeReportsPanel organisationId={profile.organisation_id} />
    </div>
  );
}
