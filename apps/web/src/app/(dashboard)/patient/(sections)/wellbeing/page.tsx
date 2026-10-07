import Link from "next/link";
import { t } from "@tarragon/i18n";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import { WellbeingTiles } from "@/app/(dashboard)/patient/wellbeing-tiles";
import { WellbeingTrendChart } from "@/app/(dashboard)/patient/wellbeing-trend-chart";
import { WellbeingCheckinForm } from "@/app/(dashboard)/patient/wellbeing-checkin-form";
import { MentalHealthSummary } from "@/components/mental-health-summary";
import { MentalHealthScreenForm } from "@/app/(dashboard)/patient/mental-health-form";
import { TherapyNetwork } from "@/components/therapy-network";
import { CategoryDetail } from "@/app/(dashboard)/patient/health-education";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CrisisCard } from "@/components/mental-health/crisis-card";
import { MentalHealthHandoffCard } from "@/components/mental-health/handoff-card";
import { SharedPhoneGate } from "@/components/mental-health/shared-phone-gate";
import { SharedPhoneSettings } from "@/components/mental-health/shared-phone-settings";
import { MoodBesideReadings } from "@/app/(dashboard)/patient/mood-beside-readings";

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
      {/* The crisis card is outside the shared-phone gate on purpose: help is never hidden. */}
      <details className="rounded-lg border border-red-200 dark:border-red-500/30 p-3">
        <summary className="cursor-pointer text-sm font-medium">{t("crisis.open_card")}</summary>
        <div className="mt-3">
          <CrisisCard />
        </div>
      </details>

      <SharedPhoneSettings />

      <SharedPhoneGate>
        <WellbeingTiles patientId={subjectId} />
        <WellbeingTrendChart patientId={subjectId} />
        <MoodBesideReadings patientId={subjectId} />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("library.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-charcoal-ink/70 dark:text-night-ink/70">{t("library.intro")}</p>
            <div className="flex flex-wrap gap-4">
              <Link className="underline" href="/patient/wellbeing/library">{t("library.title")}</Link>
              <Link className="underline" href="/patient/wellbeing/breathing">{t("breathing.library_title")}</Link>
              <Link className="underline" href="/patient/wellbeing/journal">{t("journal.title")}</Link>
              <Link className="underline" href="/patient/sleep">Sleep</Link>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <WellbeingCheckinForm patientId={subjectId} />
          <div className="space-y-4">
            <MentalHealthSummary patientId={subjectId} />
            <MentalHealthScreenForm patientId={subjectId} />
            <MentalHealthHandoffCard patientId={subjectId} />
          </div>
        </div>
      </SharedPhoneGate>

      {/* Two routes, deliberately side by side and clearly distinguished.
          In-house therapy is booked through the same appointment engine as any
          other visit (§46.8, migration 20260829098000). The independent network
          below it is a different relationship: practitioners in private
          practice whose registration Tarragon has verified, booked on
          commission. A patient deciding where to take something this personal
          is entitled to know which one they are dealing with, so neither card
          is allowed to blur into the other. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Talk to someone</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            Book a session with one of our therapists, over telemedicine or in person,
            whichever suits you.
          </p>
          <Button asChild>
            <Link href="/patient/appointments?type=therapy">Book a therapy session</Link>
          </Button>
        </CardContent>
      </Card>

      <TherapyNetwork organisationId={organisationId} patientId={subjectId} />

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
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            Any medicine your care team has started for you (including for your mental
            wellbeing) is tracked with your other medications: adherence, side effects, and
            reviews all in one place.
          </p>
          <Link href="/patient/medications" className="text-sm font-medium text-brand-green dark:text-brand-green-bright underline">
            View your medications
          </Link>
        </CardContent>
      </Card>
    </DashboardSection>
  );
}
