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
      description="Record how you are feeling, complete a mental health check-in, and learn ways to look after your wellbeing."
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

      {/* Folded: most people are on their own phone, and the full explanation, switch and PIN stood above the check-in on every
          visit (design audit S5). The "Hide now" inside stays one tap away, and the gate below still hides everything once it is on. */}
      <Disclosure title="Using a shared phone?" hint="Keep wellbeing screens hidden behind a PIN, or hide them now">
        <SharedPhoneSettings />
      </Disclosure>
      {ownProfile && <WorklistNotice enabled={features.worklist} optedOut={features.worklistActivityOptOut} />}

      <SharedPhoneGate>
        <WellbeingTiles patientId={subjectId} />
        {/* The daily check-in is the main job on this page, so it sits straight under the tiles. */}
        {/* The calm tool is already the first thing on the page; a second copy inside the form was the same button twice. */}
        <WellbeingCheckinForm patientId={subjectId} />
        <WellbeingTrendChart patientId={subjectId} />
        {/* A care-team hand-off notice is never folded away. */}
        <MentalHealthHandoffCard patientId={subjectId} />

        {/* One row of chips rather than a card with a paragraph: four doors, nothing to read first. */}
        <nav aria-label={t("library.title")} className="flex flex-wrap gap-2">
          {[
            { href: "/patient/wellbeing/library", label: t("library.title") },
            { href: "/patient/wellbeing/breathing", label: t("breathing.title") },
            { href: "/patient/wellbeing/journal", label: t("journal.title") },
            { href: "/patient/sleep", label: "Sleep" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex min-h-11 items-center rounded-full border border-charcoal-ink/15 bg-white px-4 text-sm font-medium text-charcoal-ink hover:bg-charcoal-ink/[0.03] dark:border-night-ink/20 dark:bg-night-card dark:text-night-ink"
            >
              {item.label}
            </Link>
          ))}
        </nav>

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

        {ownProfile && features.share && (
          <Disclosure title="Share with my care team" hint="Choose what to send; nothing is shared until you say so">
            <ShareSummaryCard enabled={features.share} />
          </Disclosure>
        )}
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

      <Disclosure title="Learn about mental health" hint="Short reads, and where your medicines are tracked">
        <CategoryDetail
          category="mental_health"
          patientId={subjectId}
          organisationId={organisationId}
        />
        {/* Module 46 §46.10: a mental-health medication (e.g. an SSRI) flows
            through the same medications/medication_reviews/adherence stack as
            any other prescription — no parallel medication view here. */}
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          Any medicine your care team has started for you, including for your mental wellbeing, is tracked with your other
          medications: adherence, side effects and reviews in one place.{" "}
          <Link href="/patient/medications" className="font-medium text-brand-green underline dark:text-brand-green-bright">
            View your medications
          </Link>
        </p>
      </Disclosure>
    </DashboardSection>
  );
}
