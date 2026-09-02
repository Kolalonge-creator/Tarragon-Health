import { InstitutionPrivacyNotice, CohortTooSmallNotice } from "@/components/institution-privacy-notice";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AgeBandSummary } from "../age-band-summary";
import { OutcomeEvidenceSummary } from "../outcome-evidence-summary";
import { MedicationOutcomesCard } from "@/components/medication-outcomes-card";
import { EngagementOutcomesCard } from "@/components/engagement-outcomes-card";
import { LifestyleOutcomesCard } from "@/components/lifestyle-outcomes-card";
import { WellbeingCohortSummary } from "../wellbeing-cohort-summary";
import { OutcomeReportsPanel } from "../outcome-reports-panel";
import { loadCorporateDashboardData } from "../dashboard-data";

/** Only ever rendered once corporate/layout.tsx has established an
 * organisation exists. Outcome reports (the snapshot generator) still works
 * in every remaining state — it fails gracefully on its own ("not enough
 * people yet") — so it's shown regardless; only the cohort-derived cards
 * (age bands, outcome evidence, medication/lifestyle outcomes) need the full
 * "ready" analytics. */
export default async function CorporateReportsPage() {
  const data = await loadCorporateDashboardData();
  if (data.state === "no-org" || data.state === "no-access") {
    return null;
  }

  if (data.state === "suppressed") {
    return (
      <div className="space-y-6">
        <InstitutionPrivacyNotice />
        <CohortTooSmallNotice cohortSize={data.access.cohortSize} minCohortSize={data.access.minCohortSize} />
        <OutcomeReportsPanel organisationId={data.organisationId} />
      </div>
    );
  }

  if (data.state === "no-analytics") {
    return (
      <div className="space-y-6">
        <Card variant="soft">
          <CardHeader>
            <CardTitle>Cohort analytics unavailable</CardTitle>
            <CardDescription>
              The analytics service is temporarily unavailable, so age segmentation and outcome evidence
              can&apos;t be shown right now. You can still generate an outcome report snapshot below.
            </CardDescription>
          </CardHeader>
        </Card>
        <OutcomeReportsPanel organisationId={data.organisationId} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AgeBandSummary distribution={data.ageBands} />
      <OutcomeEvidenceSummary organisationId={data.organisationId} costAvoided={data.costAvoided} />
      <MedicationOutcomesCard outcomes={data.medicationOutcomes} />
      <EngagementOutcomesCard buckets={data.engagementOutcomes} />
      <LifestyleOutcomesCard supabase={data.access.client} organisationId={data.access.organisationId} />
      <WellbeingCohortSummary metric={data.wellbeingCohortMetric} />
      <OutcomeReportsPanel organisationId={data.organisationId} />
    </div>
  );
}
