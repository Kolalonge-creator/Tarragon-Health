import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import { VitalsForm } from "@/app/(dashboard)/patient/vitals-form";
import { HbpmSummaryCard } from "@/app/(dashboard)/patient/hbpm-summary-card";
import { GlucoseInsights } from "@/app/(dashboard)/patient/glucose-insights";
import { VitalsHistory } from "@/app/(dashboard)/patient/vitals-history";
import { VitalsTrendChart } from "@/components/vitals-trend-chart";
import { SymptomLogForm } from "@/app/(dashboard)/patient/symptom-log-form";
import { SymptomLogHistory } from "@/app/(dashboard)/patient/symptom-log-history";
import { WearableConnectSection } from "@/app/(dashboard)/patient/wearable-connect-section";
import { DiabetesDailyLog } from "@/app/(dashboard)/patient/diabetes-daily-log";
import { ComplicationStatus } from "@/app/(dashboard)/patient/complication-status";
import { FootRiskStatus } from "@/app/(dashboard)/patient/foot-risk-status";

export default async function PatientVitalsPage() {
  const { subjectId } = await getPatientDashboardContext();

  return (
    <DashboardSection
      id="vitals"
      title="Vitals & symptoms"
      description="Log readings and symptoms, and see how they trend over time."
      icon={SEMANTIC_ICON.bp}
    >
      <VitalsTrendChart patientId={subjectId} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <VitalsForm patientId={subjectId} />
        <div className="space-y-4">
          <HbpmSummaryCard patientId={subjectId} />
          <GlucoseInsights patientId={subjectId} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SymptomLogForm patientId={subjectId} />
        <SymptomLogHistory patientId={subjectId} />
      </div>

      <VitalsHistory patientId={subjectId} />
      {/* Renders nothing unless the patient has an active diabetes care
          plan — see diabetes-daily-log.tsx for the gate. */}
      <DiabetesDailyLog patientId={subjectId} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ComplicationStatus patientId={subjectId} />
        <FootRiskStatus patientId={subjectId} />
      </div>
      <WearableConnectSection patientId={subjectId} />
    </DashboardSection>
  );
}
