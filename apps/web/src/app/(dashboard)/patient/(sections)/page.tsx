import Link from "next/link";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { getPatientSummaryStats, getPatientPreventionStats } from "@/app/(dashboard)/patient/summary";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import { StatTile } from "@/components/ui/stat-tile";
import { NextBestAction } from "@/app/(dashboard)/patient/next-best-action";
import { QuickActions } from "@/app/(dashboard)/patient/quick-actions";
import { TodaysDoses } from "@/app/(dashboard)/patient/todays-doses";
import { VitalsTrendChart } from "@/components/vitals-trend-chart";
import { HealthResetCard } from "@/app/(dashboard)/patient/health-reset-card";
import { RiskSignalsCard } from "@/app/(dashboard)/patient/risk-signals-card";
import { HealthTrendsCard } from "@/components/patient/health-trends-card";
import { CareScheduleCard } from "@/app/(dashboard)/patient/care-schedule-card";
import { HealthScoreCard } from "@/components/health-score-card";
import { YourCareTeam } from "@/components/your-care-team";
import { RequiresEntitlement } from "@/components/requires-entitlement";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { CareTeamContact } from "@/app/(dashboard)/patient/care-team-contact";
import { PatientTimeline } from "@/components/patient-timeline";

export default async function PatientOverviewPage() {
  const { subjectId } = await getPatientDashboardContext();
  const stats = await getPatientSummaryStats(subjectId);
  const prevention = await getPatientPreventionStats(subjectId);

  return (
    <div id="overview" className="space-y-6">
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
      <RiskSignalsCard patientId={subjectId} />
      {/* The thing a one-off lab visit structurally cannot tell someone: what
          has moved across several results. Renders nothing until there is
          genuinely enough history for a pattern. */}
      <HealthTrendsCard patientId={subjectId} audience="patient" />

      {/* Who's looking after you, and how to reach them. Paired into a row so
          the page ends in two columns instead of four more full-width cards.
          Reaching the care team no longer depends on scrolling this far —
          "Message your care team" is a quick action at the top of the page —
          but the thread itself still belongs on Overview rather than buried
          in Care & support (2026-07-30 patient-experience pass). */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <HealthScoreCard patientId={subjectId} />
        <div className="space-y-4">
          <YourCareTeam patientId={subjectId} />
          <RequiresEntitlement
            feature="doctor_checkin"
            fallback={<UpgradePrompt feature="doctor_checkin" />}
          >
            <CareTeamContact patientId={subjectId} />
          </RequiresEntitlement>
        </div>
      </div>
    </div>
  );
}
