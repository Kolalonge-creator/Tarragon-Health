import { AgeBandSummary } from "../age-band-summary";
import { OutcomeEvidenceSummary } from "../outcome-evidence-summary";
import { MedicationOutcomesCard } from "@/components/medication-outcomes-card";
import { LifestyleOutcomesCard } from "@/components/lifestyle-outcomes-card";
import { OutcomeReportsPanel } from "../outcome-reports-panel";
import { SubsidySpendSummary } from "@/components/institution/subsidy-spend-summary";
import { loadCorporateDashboardData } from "../dashboard-data";

/** Only ever rendered when corporate/layout.tsx has already established the
 * "ready" state — see page.tsx's own note. */
export default async function CorporateReportsPage() {
  const data = await loadCorporateDashboardData();
  if (data.state !== "ready") {
    return null;
  }

  return (
    <div className="space-y-6">
      <AgeBandSummary distribution={data.ageBands} />
      <OutcomeEvidenceSummary organisationId={data.organisationId} costAvoided={data.costAvoided} />
      <MedicationOutcomesCard outcomes={data.medicationOutcomes} />
      <LifestyleOutcomesCard supabase={data.access.client} organisationId={data.access.organisationId} />
      <OutcomeReportsPanel organisationId={data.organisationId} />
      <SubsidySpendSummary organisationId={data.organisationId} />
    </div>
  );
}
