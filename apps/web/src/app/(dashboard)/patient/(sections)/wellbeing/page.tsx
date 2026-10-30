import Link from "next/link";
import { t } from "@tarragon/i18n";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { Disclosure } from "@/components/ui/disclosure";
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
import { FeatureConsentGate } from "@/components/consent/feature-consent-gate";
import { CrisisCard } from "@/components/mental-health/crisis-card";
import { MentalHealthHandoffCard } from "@/components/mental-health/handoff-card";
import { SharedPhoneGate } from "@/components/mental-health/shared-phone-gate";
import { SharedPhoneSettings } from "@/components/mental-health/shared-phone-settings";
import { MoodBesideReadings } from "@/app/(dashboard)/patient/mood-beside-readings";
import { WorklistNotice } from "@/components/mental-health/worklist-notice";
import { CalmToolButton } from "@/components/mental-health/calm-tool";
import { ShareSummaryCard } from "@/components/mental-health/share-summary-card";
import { MoodPatterns } from "@/components/mental-health/mood-patterns";
import { getWellbeingFeatures } from "@/lib/wellbeing/features-server";

export default async function PatientWellbeingPage() {
  const { profile, subjectId } = await getPatientDashboardContext();
  if (!profile.organisation_id) {
    return null;
  }
  const organisationId = profile.organisation_id;
  // Which S56b features are open for this person (each behind a CMO-switched guard; all closed until then). Fails closed.
  const features = await getWellbeingFeatures();
  // The patterns view is private to the person: never shown when someone is acting for another profile.
  const ownProfile = subjectId === profile.id;

  return (
    <DashboardSection
      id="wellbeing"
      title="Wellbeing"
      description="Track how you're doing, take a mental health check-in, and learn ways to support yourself."
      icon={SEMANTIC_ICON.mood}
    >
      {/* The calm tool and the crisis card are outside the shared-phone gate on purpose: help is never hidden. */}
      <CalmToolButton enabled={features.panic} />

      <details className="rounded-lg border border-red-200 dark:border-red-500/30 p-3">
        <summary className="cursor-pointer text-sm font-medium">{t("crisis.open_card")}</summary>
        <div className="mt-3">
          <CrisisCard />
        </div>
      </details>

      <SharedPhoneSettings />
      {ownProfile && <WorklistNotice enabled={features.worklist} optedOut={features.worklistActivityOptOut} />}

      <SharedPhoneGate>
        <WellbeingTiles patientId={subjectId} />
        {/* The daily check-in is the main job on this page, so it sits straight under the tiles. */}
        <WellbeingCheckinForm patientId={subjectId} calmToolEnabled={features.panic} />
        <WellbeingTrendChart patientId={subjectId} />
        {/* A care-team hand-off notice is never folded away. */}
        <MentalHealthHandoffCard patientId={subjectId} />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("library.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-charcoal-ink/70 dark:text-night-ink/70">{t("library.intro")}</p>
            <div className="flex flex-wrap gap-4">
              <Link className="underline" href="/patient/wellbeing/library">{t("library.title")}</Link>
              <Link className="underline" href="/patient/wellbeing/breathing">{t("breathing.title")}</Link>
              <Link className="underline" href="/patient/wellbeing/journal">{t("journal.title")}</Link>
              <Link className="underline" href="/patient/sleep">Sleep</Link>
            </div>
          </CardContent>
        </Card>

        {/* Folded to keep the page short (design audit P3). Each opens in place; nothing inside was changed. */}
        <Disclosure title="Mood alongside your readings" hint="How your mood lines up with your health numbers">
          <MoodBesideReadings patientId={subjectId} />
          {ownProfile && features.insights && <MoodPatterns patientId={subjectId} hidden={features.insightsHidden} />}
        </Disclosure>

        <Disclosure title="Mental health check-in" hint="The longer questionnaire your care team reads, and your past answers">
          <MentalHealthSummary patientId={subjectId} />
          <FeatureConsentGate dataType="mental_health" onBehalfOf={subjectId !== profile.id}>
            <MentalHealthScreenForm patientId={subjectId} />
          </FeatureConsentGate>
        </Disclosure>

        {ownProfile && <ShareSummaryCard enabled={features.share} />}
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

      <Disclosure title="Independent therapists" hint="Verified private practitioners, a different relationship from our own therapists">
        <TherapyNetwork organisationId={organisationId} patientId={subjectId} />
      </Disclosure>

      <Disclosure title="Learn about mental health" hint="Short reads and guidance">
        <CategoryDetail
          category="mental_health"
          patientId={subjectId}
          organisationId={organisationId}
        />
      </Disclosure>

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
