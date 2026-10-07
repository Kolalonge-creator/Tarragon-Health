import { ageFromDateOfBirth } from "@tarragon/shared";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import { VitalsForm } from "@/app/(dashboard)/patient/vitals-form";
import { MonitoringCoverCard } from "@/components/monitoring-cover-card";
import { HbpmSummaryCard } from "@/app/(dashboard)/patient/hbpm-summary-card";
import { GlucoseInsights } from "@/app/(dashboard)/patient/glucose-insights";
import { VitalsHistory } from "@/app/(dashboard)/patient/vitals-history";
import { VitalsTrendChart } from "@/components/vitals-trend-chart";
import { SymptomLogForm } from "@/app/(dashboard)/patient/symptom-log-form";
import { SymptomLogHistory } from "@/app/(dashboard)/patient/symptom-log-history";
import { WearableConnectSection } from "@/app/(dashboard)/patient/wearable-connect-section";
import { SleepSummaryCard } from "@/app/(dashboard)/patient/sleep-summary-card";
import { DiabetesDailyLog } from "@/app/(dashboard)/patient/diabetes-daily-log";
import { DeviceSyncSupportCard } from "@/app/(dashboard)/patient/device-sync-support-card";
import { GrowthTrackingCard } from "@/app/(dashboard)/patient/growth-tracking-card";
import { SymptomTriageCheck } from "@/app/(dashboard)/patient/symptom-triage-check";
import { getSymptomCheckerEligibility, getSymptomReviewEntitled, getSymptomReviewTime, listAvailablePresentingComplaints } from "@/app/(dashboard)/patient/symptom-triage-actions";
import { degradedModeConfig } from "@/lib/symptom-triage/safe-run";
import { ComplicationStatus } from "@/app/(dashboard)/patient/complication-status";
import { FootRiskStatus } from "@/app/(dashboard)/patient/foot-risk-status";

export default async function PatientVitalsPage() {
  const { profile, subjectId, subjectDateOfBirth } = await getPatientDashboardContext();
  const ageYears = ageFromDateOfBirth(subjectDateOfBirth);
  const presentingComplaints = await listAvailablePresentingComplaints();
  // The stated review time is read from the signed SLA only when the checker is open (nothing to promise otherwise).
  const reviewTime = presentingComplaints.length > 0 ? await getSymptomReviewTime() : ({ stated: false } as const);
  // S59b: who the checker is for must be an adult with a date of birth; a clinician's look at a check is for Members.
  const eligibility = presentingComplaints.length > 0 ? await getSymptomCheckerEligibility() : ("ok" as const);
  const reviewEntitled = presentingComplaints.length > 0 ? await getSymptomReviewEntitled() : false;

  return (
    <DashboardSection
      id="vitals"
      title="Vitals & symptoms"
      description="Log readings and symptoms, and see how they trend over time."
      icon={SEMANTIC_ICON.bp}
    >
      <VitalsTrendChart patientId={subjectId} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Directly above the form someone logs a reading into, which is the
            one moment they are actually thinking about what happens to it. */}
        <MonitoringCoverCard />

        <VitalsForm patientId={subjectId} />
        <div className="space-y-4">
          <HbpmSummaryCard patientId={subjectId} />
          <GlucoseInsights patientId={subjectId} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SymptomLogForm patientId={subjectId} ageYears={ageYears} />
        <SymptomLogHistory patientId={subjectId} />
      </div>

      {/* Renders nothing once the subject is old enough that a paediatric
          growth chart no longer applies — see growth-tracking-card.tsx. */}
      <GrowthTrackingCard
        patientId={subjectId}
        organisationId={profile.organisation_id}
        ageYears={ageYears}
      />
      <SymptomTriageCheck
        patientId={subjectId}
        presentingComplaints={presentingComplaints}
        degradedConfig={degradedModeConfig()}
        reviewTime={reviewTime}
        eligibility={eligibility}
        reviewEntitled={reviewEntitled}
      />

      <VitalsHistory patientId={subjectId} />
      {/* Renders nothing unless the patient has an active diabetes care
          plan — see diabetes-daily-log.tsx for the gate. */}
      <DiabetesDailyLog patientId={subjectId} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ComplicationStatus patientId={subjectId} />
        <FootRiskStatus patientId={subjectId} />
      </div>
      {/* Renders nothing until a connected wearable has synced at least one
          night — see sleep-summary-card.tsx. */}
      <SleepSummaryCard patientId={subjectId} />
      {/* id target for the Privacy Centre's "Manage device connections" link
          (/patient/vitals#connect-devices) — that link used to land here at
          the top of Vitals with no scroll-to, which read as broken. */}
      <div id="connect-devices">
        <WearableConnectSection patientId={subjectId} />
      </div>
      <DeviceSyncSupportCard patientId={subjectId} />
    </DashboardSection>
  );
}
