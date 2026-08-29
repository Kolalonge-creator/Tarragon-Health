import Link from "next/link";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import { WellbeingTiles } from "@/app/(dashboard)/patient/wellbeing-tiles";
import { WellbeingCheckinForm } from "@/app/(dashboard)/patient/wellbeing-checkin-form";
import { MentalHealthSummary } from "@/components/mental-health-summary";
import { MentalHealthScreenForm } from "@/app/(dashboard)/patient/mental-health-form";
import { CategoryDetail } from "@/app/(dashboard)/patient/health-education";
import { Card, CardContent } from "@/components/ui/card";

export default async function PatientWellbeingPage() {
  const { profile, subjectId } = await getPatientDashboardContext();
  if (!profile.organisation_id) {
    return null;
  }
  const organisationId = profile.organisation_id;

  return (
    <DashboardSection
      id="wellbeing"
      title="Wellbeing"
      description="Track how you're doing, take a mental health check-in, and learn ways to support yourself."
      icon={SEMANTIC_ICON.mood}
    >
      <WellbeingTiles patientId={subjectId} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WellbeingCheckinForm patientId={subjectId} />
        <div className="space-y-4">
          <MentalHealthSummary patientId={subjectId} />
          <MentalHealthScreenForm patientId={subjectId} />
        </div>
      </div>

      <CategoryDetail
        category="mental_health"
        patientId={subjectId}
        organisationId={organisationId}
      />

      {/* Module 46 §46.10: a mental-health medication (e.g. an SSRI) flows
          through the same medications/medication_reviews/adherence stack as
          any other prescription — no parallel medication view here. */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <p className="text-sm text-charcoal-ink/70">
            Any medicine your care team has started for you — including for your mental
            wellbeing — is tracked with your other medications: adherence, side effects, and
            reviews all in one place.
          </p>
          <Link href="/patient/medications" className="text-sm font-medium text-brand-green underline">
            View your medications
          </Link>
        </CardContent>
      </Card>
    </DashboardSection>
  );
}
