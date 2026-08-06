import Link from "next/link";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { getPatientSummaryStats, getPatientPreventionStats } from "@/app/(dashboard)/patient/summary";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import { StatTile } from "@/components/ui/stat-tile";
import { NextBestAction } from "@/app/(dashboard)/patient/next-best-action";
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
    <DashboardSection
      id="overview"
      title="Overview"
      description={
        prevention.hasActiveCarePlan
          ? "Today at a glance: your numbers, your care team, and recent activity."
          : "Staying well at a glance: your prevention plan, your care team, and recent activity."
      }
      icon={NAV_ICON.dashboard}
    >
      <NextBestAction patientId={subjectId} />
      <HealthResetCard patientId={subjectId} />
      <RiskSignalsCard patientId={subjectId} />
      {/* The thing a one-off lab visit structurally cannot tell someone: what
          has moved across several results. Renders nothing until there is
          genuinely enough history for a pattern. */}
      <HealthTrendsCard patientId={subjectId} audience="patient" />
      <CareScheduleCard patientId={subjectId} />
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
      <HealthScoreCard patientId={subjectId} />
      <YourCareTeam patientId={subjectId} />
      {/* Messaging your care team sits right here, not buried in Care &
          support — it's the primary way to reach someone, so it needs to
          be visible without scrolling (see 2026-07-30 patient-experience
          pass in CLAUDE.md). */}
      <RequiresEntitlement feature="doctor_checkin" fallback={<UpgradePrompt feature="doctor_checkin" />}>
        <CareTeamContact patientId={subjectId} />
      </RequiresEntitlement>
      <PatientTimeline patientId={subjectId} />
    </DashboardSection>
  );
}
