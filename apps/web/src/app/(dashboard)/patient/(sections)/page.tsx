import Link from "next/link";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { getPatientSummaryStats, getPatientPreventionStats } from "@/app/(dashboard)/patient/summary";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import { StatTile } from "@/components/ui/stat-tile";
import { classifyBpLevel, BP_LEVEL_LABEL, type BpLevel } from "@/lib/rules/bp-classification";
import { getLagosGreetingWord } from "@/lib/greeting";
import { NextBestAction } from "@/app/(dashboard)/patient/next-best-action";
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
import { YourCareTeam } from "@/components/your-care-team";
import { RequiresEntitlement } from "@/components/requires-entitlement";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { CareTeamContact } from "@/app/(dashboard)/patient/care-team-contact";
import { PatientTimeline } from "@/components/patient-timeline";

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
// StatTile's delta only has three tones (brand-green/sprout-gold/grey), not a
// true clinical palette — the icon circle above carries the real clinical
// colour; this just picks the closest tone for the supporting delta text.
const BP_DELTA_DIRECTION: Record<Exclude<BpLevel, "unknown">, "up" | "down" | "flat"> = {
  green: "up",
  amber: "flat",
  red: "down",
  emergency: "down",
};

export default async function PatientOverviewPage() {
  const { subjectId, acting } = await getPatientDashboardContext();
  const stats = await getPatientSummaryStats(subjectId);
  const prevention = await getPatientPreventionStats(subjectId);

  const greetingWord = getLagosGreetingWord();
  const actingSubject = acting ? (acting.fullName ? `${acting.fullName}'s` : "their") : null;
  const weekSummaryLine = `Good ${greetingWord}. Here's how ${
    actingSubject ? `${actingSubject} week` : "this week"
  } is going.`;

  const bpLevel = classifyBpLevel(stats.latestBp?.systolic, stats.latestBp?.diastolic);
  const bpTileProps =
    bpLevel !== "unknown"
      ? {
          tintClassName: BP_TINT_CLASS[bpLevel],
          iconClassName: BP_ICON_CLASS[bpLevel],
          delta: { text: BP_LEVEL_LABEL[bpLevel], direction: BP_DELTA_DIRECTION[bpLevel] },
        }
      : {};

  return (
    <div id="overview" className="space-y-6">
      {/* One warm, human line before the hero — the "how am I doing" framing
          a patient opening the app first thing wants, without repeating the
          name DashboardPlaceholder's "Hi, {name}" already gave a moment ago
          (2026-08-17 patient-experience pass). */}
      <p className="text-sm text-charcoal-ink/60">{weekSummaryLine}</p>

      {/* Hero — the one thing the page leads with. Its copy and link are the
          same real, priority-ordered "next best step" as before; only the
          presentation moved from an inline card to this banner (Tarragon
          Health Web Dashboard design, 2026-08-09). */}
      <NextBestAction patientId={subjectId} />

      {/* The everyday jobs, one tap from the top of the page — including the
          Learn and Lifestyle coaching buttons (founder ask, 2026-08-12).
          Above the stat tiles deliberately: doing beats reading, and on a
          phone this row is what's on screen when the page opens. */}
      <QuickActions />

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
                  ? new Date(prevention.nextScreening.dueDate).toLocaleDateString("en-GB", {
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
      <PreventionCompletionCard patientId={subjectId} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
        <VitalsTrendChart patientId={subjectId} />
        <TodaysDoses patientId={subjectId} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CareScheduleCard patientId={subjectId} />
        <PatientTimeline patientId={subjectId} limit={6} />
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
      <YourCareTeam patientId={subjectId} />
      <RequiresEntitlement
        feature="doctor_checkin"
        fallback={<UpgradePrompt feature="doctor_checkin" />}
      >
        <CareTeamContact patientId={subjectId} />
      </RequiresEntitlement>
    </div>
  );
}
