import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { ContractStatusCard } from "@/components/contract-status-card";
import { getContractPerformance } from "@/lib/outcomes-contracts/get-contract-performance";
import { loadCohortAnalytics } from "@/lib/corporate/load-cohort-analytics";
import { loadCareGaps } from "@/lib/care-gaps/load-care-gaps";
import { estimateCostAvoided } from "@/lib/care-gaps/estimate-cost-avoided";
import { requireInstitutionAggregateAccess } from "@/lib/institutions/aggregate-access";
import {
  InstitutionPrivacyNotice,
  CohortTooSmallNotice,
} from "@/components/institution-privacy-notice";
import { RosterManager } from "../corporate/roster-manager";
import { OutcomeReportsPanel } from "../corporate/outcome-reports-panel";
import { CohortSummary } from "../corporate/cohort-summary";
import { CareGapPanel } from "./care-gap-panel";
import { ClaimsImpactCard } from "./claims-impact-card";
import { LifestyleOutcomesCard } from "@/components/lifestyle-outcomes-card";
import { MedicationOutcomesCard } from "@/components/medication-outcomes-card";
import { loadMedicationOutcomes } from "@/lib/outcomes/medication-outcomes";

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

  // I9: an HMO admin's own session now reads zero rows from every
  // patient-scoped table, so the aggregates come through the one verified
  // server-side doorway instead. Roster management below still runs on the
  // caller's own session — that table is the HMO's own membership list.
  const access = await requireInstitutionAggregateAccess(profile.organisation_id);
  if (!access) {
    return (
      <DashboardPlaceholder
        greeting={greeting}
        roleLabel="HMO admin"
        comingUp={["Member population risk distribution"]}
      />
    );
  }

  const header = (
    <div>
      <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{greeting}</h1>
      <p className="text-charcoal-ink/60">HMO admin dashboard</p>
    </div>
  );

  if (access.suppressed) {
    return (
      <div className="space-y-6">
        {header}
        <InstitutionPrivacyNotice entityLabel="member" />
        <CohortTooSmallNotice
          cohortSize={access.cohortSize}
          minCohortSize={access.minCohortSize}
          entityLabel="member"
        />
        <RosterManager organisationId={profile.organisation_id} entityLabel="member" />
        <OutcomeReportsPanel organisationId={profile.organisation_id} />
      </div>
    );
  }

  const [analytics, contractPerformance, careGaps, medicationOutcomes] = await Promise.all([
    loadCohortAnalytics(access.client, access.organisationId, access.minCohortSize),
    getContractPerformance(access.client, access.organisationId),
    loadCareGaps(access.client, access.organisationId, access.minCohortSize),
    loadMedicationOutcomes(access.client, access.organisationId),
  ]);

  const costAvoided = analytics
    ? await estimateCostAvoided(access.client, access.organisationId, analytics.abnormal_findings_count)
    : null;

  if (!analytics) {
    return (
      <DashboardPlaceholder
        greeting={greeting}
        roleLabel="HMO admin"
        comingUp={["Member population risk distribution (ML service unavailable)"]}
      >
        <div className="space-y-6">
          <InstitutionPrivacyNotice entityLabel="member" />
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
      {header}
      <InstitutionPrivacyNotice entityLabel="member" />
      <ContractStatusCard performance={contractPerformance} />
      <RosterManager organisationId={profile.organisation_id} entityLabel="member" />
      <CohortSummary analytics={analytics} />
      <CareGapPanel summary={careGaps} />
      <ClaimsImpactCard estimate={costAvoided} />
      <MedicationOutcomesCard outcomes={medicationOutcomes} />
      <LifestyleOutcomesCard supabase={access.client} organisationId={access.organisationId} />
      <OutcomeReportsPanel organisationId={profile.organisation_id} />
    </div>
  );
}
