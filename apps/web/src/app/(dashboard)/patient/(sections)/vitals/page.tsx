import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import { VitalsForm } from "@/app/(dashboard)/patient/vitals-form";
import { HbpmSummaryCard } from "@/app/(dashboard)/patient/hbpm-summary-card";
import { VitalsHistory } from "@/app/(dashboard)/patient/vitals-history";
import { VitalsTrendChart } from "@/components/vitals-trend-chart";
import { SymptomLogForm } from "@/app/(dashboard)/patient/symptom-log-form";
import { SymptomLogHistory } from "@/app/(dashboard)/patient/symptom-log-history";
import { WearableConnectSection } from "@/app/(dashboard)/patient/wearable-connect-section";

export default async function PatientVitalsPage() {
  const { subjectId } = await getPatientDashboardContext();

  return (
    <DashboardSection
      id="vitals"
      title="Vitals & symptoms"
      description="Log readings and symptoms, and see how they trend over time."
      icon={SEMANTIC_ICON.bp}
    >
      <VitalsForm patientId={subjectId} />
      <HbpmSummaryCard patientId={subjectId} />
      <VitalsHistory patientId={subjectId} />
      <VitalsTrendChart patientId={subjectId} />
      <SymptomLogForm patientId={subjectId} />
      <SymptomLogHistory patientId={subjectId} />
      <WearableConnectSection patientId={subjectId} />
    </DashboardSection>
  );
}
