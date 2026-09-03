import { Suspense } from "react";
import Link from "next/link";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { shouldOfferCycleTracking } from "@/lib/patient/cycle-relevance";
import { getPatientSummaryStats, getPatientPreventionStats } from "@/app/(dashboard)/patient/summary";
import { adolescentAgeBandFromDateOfBirth } from "@tarragon/shared";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import { StatTile } from "@/components/ui/stat-tile";
import { classifyBpLevel, BP_LEVEL_LABEL, type BpLevel } from "@/lib/rules/bp-classification";
import { getLagosGreetingWord } from "@/lib/greeting";
import { NextBestAction } from "@/app/(dashboard)/patient/next-best-action";
import { PaymentFailureBanner } from "@/app/(dashboard)/patient/payment-failure-banner";
import { QuickActions } from "@/app/(dashboard)/patient/quick-actions";
import { TodaysDoses } from "@/app/(dashboard)/patient/todays-doses";
import { VitalsTrendChart } from "@/components/vitals-trend-chart";
import { HealthResetCard } from "@/app/(dashboard)/patient/health-reset-card";
import { WeeklyPlanCard } from "@/app/(dashboard)/patient/weekly-plan-card";
import { BiomarkerCategoriesCard } from "@/app/(dashboard)/patient/biomarker-categories-card";
import { RiskSignalsCard } from "@/app/(dashboard)/patient/risk-signals-card";
import { HealthTrendsCard } from "@/components/patient/health-trends-card";
import { CareScheduleCard } from "@/app/(dashboard)/patient/care-schedule-card";
import { HealthScoreCard } from "@/components/health-score-card";
import { PreventionCompletionCard } from "@/app/(dashboard)/patient/prevention-completion-card";
import { HealthProgressCard } from "@/app/(dashboard)/patient/health-progress-card";
import { YourCareTeam } from "@/components/your-care-team";
import { RequiresEntitlement } from "@/components/requires-entitlement";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { CareTeamContact } from "@/app/(dashboard)/patient/care-team-contact";
import { PatientTimeline } from "@/components/patient-timeline";
import { HealthStatusBanner } from "@/components/health-status-banner";
import { formatPatientDate } from "@/lib/format-date";

// Clinical dashboard status colours (a separate system from brand colour, per
// the brand guide) — same convention as vitals-history.tsx's LEVEL_STYLE,
// just split into StatTile's separate icon-circle/icon-colour props.
const BP_TINT_CLASS: Record<Exclude<BpLevel, "unknown">, string> = {
  green: "bg-emerald-100",
  amber: "bg-amber-100",
  red: "bg-red-100",
  emergency: "bg-red-600",
};
const BP_ICON_CLASS: Record<Exclude<BpLevel, "unknown">, string> = {
  green: "text-emerald-800",
  amber: "text-amber-800",
  red: "text-red-800",
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
  return <div aria-hidden className={`animate-pulse rounded-2xl bg-charcoal-ink/[0.07] ${className}`} />;
}

export default async function PatientOverviewPage() {
  const { subjectId, acting, subjectSex, subjectDateOfBirth } = await getPatientDashboardContext();
  const stats = await getPatientSummaryStats(subjectId);
  const prevention = await getPatientPreventionStats(subjectId);

  const greetingWord = getLagosGreetingWord();
  const actingSubject = acting ? (acting.fullName ? `${acting.fullName}'s` : "their") : null;
  const weekSummaryLine = `Good ${greetingWord}. Here's how ${
    actingSubject ? `${actingSubject} week` : "this week"
  } is going.`;

  // Age-aware framing (spec §49.3: younger child = parent-managed, older
  // adolescent = increasing direct engagement, young adult = independent).
  // Framing only — nothing here is a security boundary, and nothing changes
  // what data loads; see private.adolescent_age_band for the real gate.
  const subjectAgeBand = adolescentAgeBandFromDateOfBirth(subjectDateOfBirth);
  const isAdolescentBand = subjectAgeBand === "younger_adolescent" || subjectAgeBand === "older_adolescent";

  const bpLevel = classifyBpLevel(stats.latestBp?.systolic, stats.latestBp?.diastolic);
  const bpTileProps =
    bpLevel !== "unknown"
      ? {
          tintClassName: BP_TINT_CLASS[bpLevel],
          iconClassName: BP_ICON_CLASS[bpLevel],
          status: { text: BP_LEVEL_LABEL[bpLevel], tone: BP_STATUS_TONE[bpLevel] },
        }
      : {};

  return (
    <div id="overview" className="space-y-6">
      {/* One warm, human line before the hero — the "how am I doing" framing
          a patient opening the app first thing wants, without repeating the
          name DashboardPlaceholder's "Hi, {name}" already gave a moment ago
          (2026-08-17 patient-experience pass). */}
      <p className="text-sm text-charcoal-ink/60">{weekSummaryLine}</p>
      <HealthStatusBanner patientId={subjectId} />

      {/* §91.10 — an unpaid plan is more urgent than a wellness nudge, so it
          renders above NextBestAction. Renders nothing when there's no
          payment problem. */}
      <PaymentFailureBanner patientId={subjectId} />

      {/* Age-aware framing (spec §49.3/§49.4) — a single soft line, never an
          urgent banner: a self-harm/safety-adjacent check-in doesn't belong
          in the same visual register as "refill due" or "screening
          overdue" (CLAUDE.md brand voice: no fear-based urgency). Two
          mutually exclusive cases: the teen looking at their own dashboard
          gets a low-key nudge toward the check-in; a parent/guardian
          looking at a teen's dashboard while acting for them gets a
          reminder that some things stay private even from them. Neither
          renders for a child-band dependent (parent-managed, no carve-out)
          or an adult/unknown band (no adolescent framing needed). */}
      {isAdolescentBand && !acting && (
        <p className="text-sm text-charcoal-ink/60">
          <Link href="/patient/adolescent-health" className="text-brand-green hover:underline">
            Your private whole-life check-in
          </Link>{" "}
          is there whenever you want it, just for you, on your own time.
        </p>
      )}
      {isAdolescentBand && acting && (
        <p className="text-sm text-charcoal-ink/60">
          Some things, like {acting.fullName ?? "their"} own private wellbeing check-in, stay just
          between them and their care team.
        </p>
      )}

      {/* Hero — the one thing the page leads with. Its copy and link are the
          same real, priority-ordered "next best step" as before; only the
          presentation moved from an inline card to this banner (Tarragon
          Health Web Dashboard design, 2026-08-09). */}
      <Suspense fallback={<CardSkeleton className="h-32 sm:h-28" />}>
        <NextBestAction patientId={subjectId} />
      </Suspense>

      {/* The everyday jobs, one tap from the top of the page — including the
          Learn and Lifestyle coaching buttons (founder ask, 2026-08-12).
          Above the stat tiles deliberately: doing beats reading, and on a
          phone this row is what's on screen when the page opens. */}
      <QuickActions showCycle={shouldOfferCycleTracking(subjectSex)} />

      {/* Dual-state overview: a patient in a chronic programme leads with
          monitoring numbers; a healthy patient leads with prevention. Both
          states read the same shared record — nothing is hidden, only led
          with differently. */}
      {prevention.hasActiveCarePlan ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatTile
            icon={SEMANTIC_ICON.bp}
            label="Latest BP"
            value={stats.latestBp ? `${stats.latestBp.systolic}/${stats.latestBp.diastolic}` : "—"}
            unit="mmHg"
            {...bpTileProps}
          />
          <StatTile
            icon={SEMANTIC_ICON.diabetes}
            label="Latest glucose"
            value={stats.latestGlucoseMmolL !== null ? String(stats.latestGlucoseMmolL) : "—"}
            unit="mmol/L"
          />
          <StatTile
            icon={SEMANTIC_ICON.medication}
            label="Active meds"
            value={String(stats.activeMedicationCount)}
          />
          <StatTile
            icon={SEMANTIC_ICON.preventive}
            label="Doses today"
            value={`${stats.dosesTaken}/${stats.dosesTotal}`}
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatTile
              icon={SEMANTIC_ICON.preventive}
              label="Screenings due"
              value={prevention.hasRiskAssessment ? String(prevention.screeningsDueCount) : "—"}
            />
            <StatTile
              icon={SEMANTIC_ICON.labs}
              label="Next screening"
              value={
                prevention.nextScreening
                  ? formatPatientDate(prevention.nextScreening.dueDate, {
                      day: "numeric",
                      month: "short",
                    })
                  : "—"
              }
            />
            <StatTile
              icon={NAV_ICON.vaccination}
              label="Vaccines due"
              value={prevention.hasRiskAssessment ? String(prevention.vaccinationsDueCount) : "—"}
            />
            <StatTile
              icon={SEMANTIC_ICON.bp}
              label="Latest BP"
              value={stats.latestBp ? `${stats.latestBp.systolic}/${stats.latestBp.diastolic}` : "—"}
              unit="mmHg"
              {...bpTileProps}
            />
          </div>
          {!prevention.hasRiskAssessment && (
            <p className="text-sm text-charcoal-ink/70">
              Two minutes on your{" "}
              <Link href="/patient/prevention" className="text-brand-green hover:underline">
                health profile
              </Link>{" "}
              builds your personal screening and vaccination calendar: the checks that keep
              healthy people healthy.
            </p>
          )}
        </>
      )}

      {/* "How am I doing" belongs right under the numbers that answer it, not
          six cards further down the page where a morning check-in wouldn't
          reach it (2026-08-17 patient-experience pass). Its own trend line
          (lib/rules/health-score.ts's computeHealthScoreTrend) is the real,
          already-computed "you're on track" reassurance — nothing new to
          fabricate here. */}
      <HealthScoreCard patientId={subjectId} />

      {/* Deliberately separate from the Health Score above, not a second way
          to show the same number — this is a completion checklist by area
          (spec: "avoid presenting a misleading single health score ... a
          prevention completion dashboard is safer and more actionable"),
          answering "what's outstanding" rather than "how am I doing overall". */}
      <Suspense fallback={<CardSkeleton className="h-32" />}>
        <PreventionCompletionCard patientId={subjectId} />
      </Suspense>

      {/* Behavioural engagement across areas (Patient Engagement Engine
          spec §16.5) — distinct from both cards above: HealthScoreCard is
          clinical status, PreventionCompletionCard is prevention-specific
          completion. This one answers "am I keeping up" more broadly
          (monitoring, appointments, medication, lifestyle, prevention, care
          plan), same self-hiding + no-single-score conventions. */}
      <Suspense fallback={<CardSkeleton className="h-32" />}>
        <HealthProgressCard patientId={subjectId} />
      </Suspense>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
        <VitalsTrendChart patientId={subjectId} />
        <TodaysDoses patientId={subjectId} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Suspense fallback={<CardSkeleton className="h-56" />}>
          <CareScheduleCard patientId={subjectId} />
        </Suspense>
        <PatientTimeline patientId={subjectId} limit={6} viewAllHref="/patient/timeline" />
      </div>

      {/* Conditional clinical cards — each self-hides when the patient has no
          data behind it, so for most people this band renders nothing at all.
          Kept full-width and stacked rather than paired into a grid for that
          reason: a two-column row whose other half returns null leaves a hole
          in the page. */}
      <HealthResetCard patientId={subjectId} />
      {/* Renders nothing without an active lifestyle-programme enrolment
          (lib/lpe/weekly-plan.ts) — additive, not a forced habit tracker for
          every patient, same self-hiding convention as the cards above. */}
      <WeeklyPlanCard patientId={subjectId} />
      <RiskSignalsCard patientId={subjectId} />
      {/* Renders nothing until at least one clinician-reviewed lab result is
          on file — never a fabricated good/needs-attention judgement from
          an ML-only or orientation-only signal (lib/lab-reports/
          biomarker-categories.ts). */}
      <BiomarkerCategoriesCard patientId={subjectId} />
      {/* The thing a one-off lab visit structurally cannot tell someone: what
          has moved across several results. Renders nothing until there is
          genuinely enough history for a pattern. */}
      <HealthTrendsCard patientId={subjectId} audience="patient" />

      {/* Who's looking after you, and how to reach them. Full-width like the
          clinical cards above, matching the same "a two-column row whose
          other half returns null leaves a hole" reasoning — no longer paired
          with HealthScoreCard now that the score moved up near the stat
          tiles (2026-08-17 patient-experience pass). Reaching the care team
          no longer depends on scrolling this far — "Message your care team"
          is a quick action at the top of the page — but the thread itself
          still belongs on Overview rather than buried in Care & support
          (2026-07-30 patient-experience pass). */}
      <Suspense fallback={<CardSkeleton className="h-40" />}>
        <YourCareTeam patientId={subjectId} />
      </Suspense>
      <RequiresEntitlement
        feature="doctor_checkin"
        fallback={<UpgradePrompt feature="doctor_checkin" />}
      >
        <CareTeamContact patientId={subjectId} />
      </RequiresEntitlement>
    </div>
  );
}
