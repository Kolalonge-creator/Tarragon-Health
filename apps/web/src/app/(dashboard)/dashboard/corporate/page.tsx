import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { ContractStatusCard } from "@/components/contract-status-card";
import { getContractPerformance } from "@/lib/outcomes-contracts/get-contract-performance";
import { loadCohortAnalytics } from "@/lib/corporate/load-cohort-analytics";
import { requireInstitutionAggregateAccess } from "@/lib/institutions/aggregate-access";
import {
  InstitutionPrivacyNotice,
  CohortTooSmallNotice,
} from "@/components/institution-privacy-notice";
import { RosterManager } from "./roster-manager";
import { OutcomeReportsPanel } from "./outcome-reports-panel";
import { CohortSummary } from "./cohort-summary";
import { AgeBandSummary } from "./age-band-summary";
import { OutcomeEvidenceSummary } from "./outcome-evidence-summary";
import { loadAgeBandDistribution } from "@/lib/corporate/load-age-band-distribution";
import { estimateCostAvoided } from "@/lib/care-gaps/estimate-cost-avoided";
import { LifestyleOutcomesCard } from "@/components/lifestyle-outcomes-card";
import { MedicationOutcomesCard } from "@/components/medication-outcomes-card";
import { loadMedicationOutcomes } from "@/lib/outcomes/medication-outcomes";

export default async function CorporatePage() {
  const profile = await getCurrentProfile();
  const greeting = `Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`;

  if (!profile?.organisation_id) {
    return (
      <DashboardPlaceholder
        greeting={greeting}
        roleLabel="Corporate admin"
        comingUp={["Staff enrolment", "Workforce health: cohort risk distribution"]}
      />
    );
  }

  // I9: a corporate admin's own session now reads zero rows from every
  // patient-scoped table, so the aggregates come through the one verified
  // server-side doorway instead. Roster management below still runs on the
  // caller's own session — that table is the employer's own staff list.
  const access = await requireInstitutionAggregateAccess(profile.organisation_id);
  if (!access) {
    return (
      <DashboardPlaceholder
        greeting={greeting}
        roleLabel="Corporate admin"
        comingUp={["Workforce health: cohort risk distribution"]}
      />
    );
  }

  const header = (
    <div>
      <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{greeting}</h1>
      <p className="text-charcoal-ink/60">Corporate admin dashboard</p>
    </div>
  );

  if (access.suppressed) {
    return (
      <div className="space-y-6">
        {header}
        <InstitutionPrivacyNotice />
        <CohortTooSmallNotice
          cohortSize={access.cohortSize}
          minCohortSize={access.minCohortSize}
        />
        <RosterManager organisationId={profile.organisation_id} />
        <OutcomeReportsPanel organisationId={profile.organisation_id} />
      </div>
    );
  }

  const [analytics, contractPerformance] = await Promise.all([
    loadCohortAnalytics(access.client, access.organisationId, access.minCohortSize),
    getContractPerformance(access.client, access.organisationId),
  ]);

  if (!analytics) {
    return (
      <DashboardPlaceholder
        greeting={greeting}
        roleLabel="Corporate admin"
        comingUp={["Workforce health: cohort risk distribution (ML service unavailable)"]}
      >
        <div className="space-y-6">
          <InstitutionPrivacyNotice />
          <ContractStatusCard performance={contractPerformance} />
          <RosterManager organisationId={profile.organisation_id} />
          <OutcomeReportsPanel organisationId={profile.organisation_id} />
        </div>
      </DashboardPlaceholder>
    );
  }

  const [ageBands, costAvoided, medicationOutcomes] = await Promise.all([
    loadAgeBandDistribution(access.client, access.organisationId),
    estimateCostAvoided(access.client, access.organisationId, analytics.abnormal_findings_count),
    loadMedicationOutcomes(access.client, access.organisationId),
  ]);

  return (
    <div className="space-y-6">
      {header}
      <InstitutionPrivacyNotice />
      <ContractStatusCard performance={contractPerformance} />
      <RosterManager organisationId={profile.organisation_id} />
      <CohortSummary analytics={analytics} />
      <AgeBandSummary distribution={ageBands} />
      <OutcomeEvidenceSummary organisationId={profile.organisation_id} costAvoided={costAvoided} />
      <MedicationOutcomesCard outcomes={medicationOutcomes} />
      <LifestyleOutcomesCard supabase={access.client} organisationId={access.organisationId} />
      <OutcomeReportsPanel organisationId={profile.organisation_id} />
    </div>
  );
}
