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
import { FeatureAnchor } from "@/components/patient/feature-anchor";

export default async function PatientVitalsPage() {
  const { subjectId } = await getPatientDashboardContext();

  return (
    <DashboardSection
      id="vitals"
      title="Vitals & symptoms"
      description="Log readings and symptoms, and see how they trend over time."
      icon={SEMANTIC_ICON.bp}
    >
      {/* Anchor ids below are the registry's contract (lib/patient/
          feature-registry.ts): every href with a #fragment must resolve to a
          real FeatureAnchor on this page, or search sends a patient to a
          page and leaves them to find the card themselves. */}
      <FeatureAnchor id="trends">
        <VitalsTrendChart patientId={subjectId} />
      </FeatureAnchor>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FeatureAnchor id="log-reading">
          <VitalsForm patientId={subjectId} />
        </FeatureAnchor>
        <div className="space-y-4">
          <FeatureAnchor id="bp-summary">
            <HbpmSummaryCard patientId={subjectId} />
          </FeatureAnchor>
          <FeatureAnchor id="glucose">
            <GlucoseInsights patientId={subjectId} />
          </FeatureAnchor>
        </div>
      </div>

      <FeatureAnchor id="symptoms" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SymptomLogForm patientId={subjectId} />
        <SymptomLogHistory patientId={subjectId} />
      </FeatureAnchor>

      <FeatureAnchor id="history">
        <VitalsHistory patientId={subjectId} />
      </FeatureAnchor>
      {/* Renders nothing unless the patient has an active diabetes care
          plan — see diabetes-daily-log.tsx for the gate. */}
      <FeatureAnchor id="diabetes-log">
        <DiabetesDailyLog patientId={subjectId} />
      </FeatureAnchor>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FeatureAnchor id="complications">
          <ComplicationStatus patientId={subjectId} />
        </FeatureAnchor>
        <FeatureAnchor id="foot-risk">
          <FootRiskStatus patientId={subjectId} />
        </FeatureAnchor>
      </div>
      <FeatureAnchor id="wearables">
        <WearableConnectSection patientId={subjectId} />
      </FeatureAnchor>
    </DashboardSection>
  );
}
