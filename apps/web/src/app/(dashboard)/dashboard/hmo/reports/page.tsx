import { ClaimsImpactCard } from "../claims-impact-card";
import { MedicationOutcomesCard } from "@/components/medication-outcomes-card";
import { EngagementOutcomesCard } from "@/components/engagement-outcomes-card";
import { LifestyleOutcomesCard } from "@/components/lifestyle-outcomes-card";
import { OutcomeReportsPanel } from "../../corporate/outcome-reports-panel";
import { SubsidySpendSummary } from "@/components/institution/subsidy-spend-summary";
import { loadHmoDashboardData } from "../dashboard-data";

/** Only ever rendered when hmo/layout.tsx has already established the
 * "ready" state — see page.tsx's own note. */
export default async function HmoReportsPage() {
  const data = await loadHmoDashboardData();
  if (data.state !== "ready") {
    return null;
  }

  return (
    <div className="space-y-6">
      <ClaimsImpactCard estimate={data.costAvoided} />
      <MedicationOutcomesCard outcomes={data.medicationOutcomes} entityLabel="member" />
      <EngagementOutcomesCard buckets={data.engagementOutcomes} entityLabel="member" />
      <LifestyleOutcomesCard
        supabase={data.access.client}
        organisationId={data.access.organisationId}
        entityLabel="member"
      />
      <OutcomeReportsPanel organisationId={data.organisationId} />
      <SubsidySpendSummary organisationId={data.organisationId} />
    </div>
  );
}
