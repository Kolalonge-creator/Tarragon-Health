import { Suspense } from "react";
import { LazyVitalsTrendChart } from "@/components/vitals-trend-chart-lazy";
import { createClient } from "@/lib/supabase/server";
import { isAssistantOffered } from "@/lib/ai-coach/offered";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { CareModeSwitchIfSupporting } from "@/components/care-circle/care-mode-switch";
import { shouldOfferCycleTracking } from "@/lib/patient/cycle-relevance";
import { getPatientSummaryStats, getPatientPreventionStats } from "@/app/(dashboard)/patient/summary";
import { lockedHomePins, resolveHomePins } from "@tarragon/shared";
import {
  GetStartedCard,
  isFirstRun,
  shouldShowGetStarted,
} from "@/app/(dashboard)/patient/get-started-card";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import { StatTile } from "@/components/ui/stat-tile";
import { HomePinTiles } from "@/app/(dashboard)/patient/home-pin-tiles";
import { ManageHomePins } from "@/app/(dashboard)/patient/manage-home-pins";
import { getMonitoredVitals, getStoredHomePins } from "@/lib/patient/home-pins";
import { statTileValue } from "@/components/ui/stat-tile-value";
import { classifyBpLevel, BP_LEVEL_LABEL, type BpLevel } from "@/lib/rules/bp-classification";
import { OverviewHero } from "@/app/(dashboard)/patient/overview-hero";
import { ServiceStatusCard } from "@/app/(dashboard)/patient/service-status-card";
import { SinceYouWereLastHere } from "@/app/(dashboard)/patient/since-you-were-last-here-card";
import { PaymentFailureBanner } from "@/app/(dashboard)/patient/payment-failure-banner";
import { QuickActions } from "@/app/(dashboard)/patient/quick-actions";
import { YourFocusCard } from "@/app/(dashboard)/patient/your-focus-card";
import { AskTarragonCard } from "@/app/(dashboard)/patient/ask-tarragon-card";
import { WeeklyLessonCard } from "@/components/learning/weekly-lesson-card";
import { RecordLessonCard } from "@/components/learning/record-lesson-card";
import { TodaysDoses } from "@/app/(dashboard)/patient/todays-doses";
import { HealthResetCard } from "@/app/(dashboard)/patient/health-reset-card";
import { WeeklyPlanCard } from "@/app/(dashboard)/patient/weekly-plan-card";
import { BiomarkerCategoriesCard } from "@/app/(dashboard)/patient/biomarker-categories-card";
import { RiskSignalsCard } from "@/app/(dashboard)/patient/risk-signals-card";
import { HealthDomainsCard } from "@/app/(dashboard)/patient/health-domains-card";
import { HealthTrendsCard } from "@/components/patient/health-trends-card";
import { CareScheduleCard } from "@/app/(dashboard)/patient/care-schedule-card";
import { HeartAgeCard } from "@/components/heart-age-card";
import { PreventionCompletionCard } from "@/app/(dashboard)/patient/prevention-completion-card";
import { HealthProgressCard } from "@/app/(dashboard)/patient/health-progress-card";
import { ServicesPromoCard } from "@/app/(dashboard)/patient/services-promo-card";
import { YourCareTeam } from "@/components/your-care-team";
import { CareTeamContact } from "@/app/(dashboard)/patient/care-team-contact";
import { PatientTimeline } from "@/components/patient-timeline";
import { formatPatientDate } from "@/lib/format-date";
import { STATUS_CLASSES } from "@tarragon/ui/status";
import { HomeOverviewSection } from "@/app/(dashboard)/patient/home/home-overview-section";
import { EducationPickCard } from "@/app/(dashboard)/patient/home/education-pick-card";
import { LazyFold } from "@/app/(dashboard)/patient/home/lazy-fold";

// Clinical status tokens (packages/ui tokens.ts; a separate system from brand
// colour, per the brand guide), split into StatTile's separate icon-circle /
// icon-colour props. The band label beside it carries the words, so colour is
// never the only signal.
const BP_TINT_CLASS: Record<Exclude<BpLevel, "unknown">, string> = {
  green: STATUS_CLASSES.normal.tint,
  amber: STATUS_CLASSES.attention.tint,
  red: STATUS_CLASSES.critical.tint,
  emergency: STATUS_CLASSES.critical.dot,
};
const BP_ICON_CLASS: Record<Exclude<BpLevel, "unknown">, string> = {
  green: STATUS_CLASSES.normal.icon,
  amber: STATUS_CLASSES.attention.icon,
  red: STATUS_CLASSES.critical.icon,
  emergency: "text-white",
};
// StatTile's `status` line renders in the clinical status palette — the band
// label ("Crisis range") must never pass through the brand-toned `delta` slot,
// where a red/emergency reading would come out in decorative sprout-gold.
const BP_STATUS_TONE: Record<Exclude<BpLevel, "unknown">, "green" | "amber" | "red"> = {
  green: "green",
  amber: "amber",
  red: "red",
  emergency: "red",
};

/** Small Suspense fallback for one streamed-in card — the independent async
 * server-component cards below each run their own queries, so wrapping them
 * lets the rest of the page paint instead of the whole Overview waiting on
 * the slowest one. Matches (sections)/loading.tsx's pulse-block treatment. */
function CardSkeleton({ className = "h-40" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-2xl bg-charcoal-ink/[0.07] dark:bg-night-ink/10 ${className}`} />;
}

export default async function PatientOverviewPage() {
  const { subjectId, acting, subjectSex, glucoseUnit, measurementUnits, profile, uiLanguage } =
    await getPatientDashboardContext();
  // Independent reads: run them together, not one after another.
  const supabase = await createClient();
  const [stats, prevention, storedPins, monitored, coachAccess] = await Promise.all([
    getPatientSummaryStats(subjectId),
    getPatientPreventionStats(subjectId),
    // The patient's own pinned tiles. A supporter acting for someone else cannot
    // read (or change) that person's layout, so they see the defaults.
    acting ? Promise.resolve({ pins: null, readFailed: false }) : getStoredHomePins(subjectId),
    // The vitals this patient's programme monitors: their pins cannot be switched off.
    getMonitoredVitals(subjectId),
    // Same gate ai-coach-chat.tsx's own mount point (care/page.tsx) applies —
    // runCoachTurn's own entitlement check would otherwise return a canned
    // decline reply that AskTarragonCard has no way to distinguish from a real
    // answer (it would render with the doctor/booking CTAs and a "report this
    // answer" control, same as any other reply).
    isAssistantOffered(supabase),
  ]);

  // The greeting (spec 4.1, PD-05) is the page heading, drawn by section-greeting.tsx; the hero no longer repeats it.

  // Day-one state. Every analytic card below is right for a patient with a
  // history and useless for one without: on an empty account they collectively
  // said "no reading yet" five times, charted nothing, and ended on a prompt
  // to pay. A patient part-way through setup still keeps the full dashboard --
  // they have real data worth charting -- so the card and the suppression ask
  // two different questions.
  const progress = {
    hasRiskAssessment: prevention.hasRiskAssessment,
    hasAnyVitals: stats.hasAnyVitals,
    hasMedications: stats.activeMedicationCount > 0,
    // A patient with no chronic signal yet, and nothing logged, has no
    // reading/medication step to do -- see PatientPreventionStats.hasChronicCondition.
    needsMonitoringSteps:
      prevention.hasChronicCondition || stats.hasAnyVitals || stats.activeMedicationCount > 0,
  };
  const showGetStarted = shouldShowGetStarted(progress);
  const firstRun = isFirstRun(progress) && !prevention.hasChronicCondition;

  const bpLevel = classifyBpLevel(stats.latestBp?.systolic, stats.latestBp?.diastolic);
  const bpTileProps =
    bpLevel !== "unknown"
      ? {
          tintClassName: BP_TINT_CLASS[bpLevel],
          iconClassName: BP_ICON_CLASS[bpLevel],
          status: { text: BP_LEVEL_LABEL[bpLevel], tone: BP_STATUS_TONE[bpLevel] },
        }
      : {};

  // Chronic-programme patients lead with all four numbers; a preventive-care
  // patient already has three screening tiles above, so only BP by default.
  const pinContext = { activeMedicationCount: stats.activeMedicationCount, monitoredVitals: monitored.vitals };
  // A preventive-care patient already has "Screenings due" in the fixed row above, so that pin is not drawn twice.
  const allPins = resolveHomePins(
    storedPins.pins,
    pinContext,
    prevention.hasActiveCarePlan ? undefined : ["bp"],
  );
  const pins = prevention.hasActiveCarePlan ? allPins : allPins.filter((pin) => pin !== "screenings");

  return (
    <div id="overview" className="space-y-6">
      {/* §91.10 — an unpaid plan is more urgent than a wellness nudge, so it
          renders above the hero band. Renders nothing when there's no
          payment problem. */}
      <PaymentFailureBanner patientId={subjectId} />

      {/* For someone who is both a patient and a supporter: one tap between their own health and the people they support. */}
      {!acting ? <CareModeSwitchIfSupporting locale={uiLanguage} /> : null}

      {/* The page's identity moment: one band answering "how am I doing"
          (Health Score, white panel — clinical status colours stay on a
          neutral surface, never on brand green) and "what's the one thing to
          do next" (the priority-ordered NextBestAction on the deep-green
          gradient). The greeting is the page heading above it (section-greeting.tsx), not repeated here. */}
      <OverviewHero patientId={subjectId} acting={!!acting} />

      {/* For a new patient the set-up steps are the real next step, so they sit straight under it. */}
      {showGetStarted && (
        <GetStartedCard
          progress={progress}
          acting={acting?.fullName ?? null}
        />
      )}

      {/* PD-05 order: status strip, next appointment, care journey (PD-03, every patient). Streamed: its reads never hold up the hero. */}
      <Suspense fallback={<CardSkeleton className="h-64" />}>
        <HomeOverviewSection
          patientId={subjectId}
          acting={!!acting}
          hasRiskAssessment={prevention.hasRiskAssessment}
          hasAnyVitals={stats.hasAnyVitals}
        />
      </Suspense>

      {/* States plainly whether a clinician is actually watching this account right now: a free/self-tracking patient must never be
          left to infer a funded clinician relationship that does not exist. */}
      <ServiceStatusCard patientId={subjectId} acting={!!acting} />

      {/* Informational "while you were away" reel; renders only after a real gap and only when something happened. */}
      <SinceYouWereLastHere patientId={subjectId} acting={!!acting} />

      {/* The everyday jobs, one tap from the top of the page. */}
      <QuickActions showCycle={shouldOfferCycleTracking(subjectSex)} />

      {/* A brand-new patient has nothing else to read yet, so the "ask" card stays in view for them; everyone else finds it under "More". */}
      {firstRun && <AskTarragonCard patientId={subjectId} coachAccess={coachAccess} />}

      {/* Today (PD-05): doses and the readings the patient pins. Not rendered on an empty account (GetStartedCard stands in). */}
      {!firstRun && (
        <>
          <TodaysDoses patientId={subjectId} />

          <section aria-label="Pinned tiles" className="space-y-3">
            {!acting && (
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-charcoal-ink/70 dark:text-night-ink/70">Pinned</h2>
                {/* Hidden when the saved layout could not be read: saving from the defaults would overwrite it. */}
                {!storedPins.readFailed && <ManageHomePins initialPins={allPins} lockedPins={lockedHomePins(pinContext)} />}
              </div>
            )}
            <HomePinTiles
              patientId={subjectId}
              pins={pins}
              stats={stats}
              glucoseUnit={glucoseUnit}
              units={measurementUnits}
              screeningsDue={{ hasRiskAssessment: prevention.hasRiskAssessment, count: prevention.screeningsDueCount }}
              bpTileProps={bpTileProps}
            />
          </section>

          {/* Clinical signals stay in view (never folded away): they self-hide when there is nothing behind them. */}
          <RiskSignalsCard patientId={subjectId} />
          {/* Clinician-reviewed lab categories, including any that need attention. Self-hides without a reviewed result. */}
          <BiomarkerCategoriesCard patientId={subjectId} />

          {/* Recent activity (spec 4.6), each row linking to its own record. */}
          <PatientTimeline patientId={subjectId} limit={4} viewAllHref="/patient/timeline" linkBasePath="/patient" />
        </>
      )}

      {/* One reading from the patient's own personalised feed (spec 4.8). */}
      <Suspense fallback={null}>
        <EducationPickCard acting={!!acting} />
      </Suspense>

      {/* Everything else (PD-05), mounted only when the patient opens it. */}
      {!firstRun && (
        <LazyFold title="More about your health">
              <Suspense fallback={<CardSkeleton className="h-56" />}>
                <CareScheduleCard patientId={subjectId} />
              </Suspense>

              {/* The long "ask" form lives here; Quick actions above already offers "Upload a result" and "Message your care team". */}
              <AskTarragonCard patientId={subjectId} coachAccess={coachAccess} />

              <Suspense fallback={<CardSkeleton className="h-32" />}>
                <YourFocusCard patientId={subjectId} acting={!!acting} />
              </Suspense>

              {/* S55: this week's micro-lesson (spec 9.2). Renders nothing when there is no in-date lesson. */}
              {profile.organisation_id && !acting && (
                <WeeklyLessonCard patientId={subjectId} organisationId={profile.organisation_id} />
              )}
              {/* Item 7: "what this reading means"; behind a go-live guard that is OFF, so it renders nothing by default. */}
              {profile.organisation_id && !acting && <RecordLessonCard patientId={subjectId} />}

      {/* Dual-state overview: a patient in a chronic programme leads with
              monitoring numbers; a healthy patient leads with prevention. Both
              states read the same shared record — nothing is hidden, only led
              with differently. */}
          {prevention.hasActiveCarePlan ? null : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {/* Without a risk assessment there's no calendar to count against —
                    a friendly hint, never a bare display-scale dash. */}
                {prevention.hasRiskAssessment ? (
                  <StatTile
                    icon={SEMANTIC_ICON.preventive}
                    label="Screenings due"
                    value={String(prevention.screeningsDueCount)}
                  />
                ) : (
                  <StatTile
                    icon={SEMANTIC_ICON.preventive}
                    label="Screenings due"
                    empty={{ hint: "None scheduled yet" }}
                  />
                )}
                <StatTile
                  icon={SEMANTIC_ICON.labs}
                  label="Next screening"
                  {...statTileValue(
                    prevention.nextScreening
                      ? formatPatientDate(prevention.nextScreening.dueDate, {
                          day: "numeric",
                          month: "short",
                        })
                      : null,
                    "None scheduled yet"
                  )}
                />
                {prevention.hasRiskAssessment ? (
                  <StatTile
                    icon={NAV_ICON.vaccination}
                    label="Vaccines due"
                    value={String(prevention.vaccinationsDueCount)}
                  />
                ) : (
                  <StatTile
                    icon={NAV_ICON.vaccination}
                    label="Vaccines due"
                    empty={{ hint: "None scheduled yet" }}
                  />
                )}
            </div>
          )}

              {/* T2-06: health status by area replaces the composite Health Score (no number score until one is validated). */}
              <HealthDomainsCard patientId={subjectId} canViewReproductive={!acting} />
              <Suspense fallback={<CardSkeleton className="h-32" />}>
                <PreventionCompletionCard patientId={subjectId} />
              </Suspense>

              <HeartAgeCard patientId={subjectId} />

              <Suspense fallback={<CardSkeleton className="h-32" />}>
                <HealthProgressCard patientId={subjectId} />
              </Suspense>

              <LazyVitalsTrendChart patientId={subjectId} />

              <ServicesPromoCard />

              {/* Conditional clinical cards: each self-hides when the patient has no data behind it. */}
              <HealthResetCard patientId={subjectId} />
              <WeeklyPlanCard patientId={subjectId} />
              <HealthTrendsCard patientId={subjectId} audience="patient" />

              <Suspense fallback={<CardSkeleton className="h-40" />}>
                <YourCareTeam patientId={subjectId} />
              </Suspense>
              {/* MSG-1: messaging is open to every plan; only clinical and medicine topics need Membership, and the database enforces that. */}
              <CareTeamContact patientId={subjectId} />
        </LazyFold>
      )}
    </div>
  );
}
