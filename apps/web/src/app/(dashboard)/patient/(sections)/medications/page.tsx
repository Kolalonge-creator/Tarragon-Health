import { createClient } from "@/lib/supabase/server";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import { TodaysDoses } from "@/app/(dashboard)/patient/todays-doses";
import { MedicationsList } from "@/app/(dashboard)/patient/medications-list";
import { AdherenceCheckins } from "@/app/(dashboard)/patient/adherence-checkins";
import { CheckMyPack } from "@/app/(dashboard)/patient/check-my-pack";
import { LabMonitoringCard } from "@/app/(dashboard)/patient/lab-monitoring-card";
import { AddMedicationForm } from "@/app/(dashboard)/patient/add-medication-form";
import { FeatureAnchor } from "@/components/patient/feature-anchor";

export default async function PatientMedicationsPage() {
  const { subjectId } = await getPatientDashboardContext();

  const supabase = await createClient();
  const { data: refillCoordinationEnabled } = await supabase.rpc("has_feature_access", {
    feature: "medication_refills",
  });

  return (
    <DashboardSection
      id="medications"
      title="Medications"
      description="Today's doses and your medicines cabinet."
      icon={SEMANTIC_ICON.medication}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr] lg:items-start">
        <div className="space-y-4">
          <FeatureAnchor id="my-medications">
            <MedicationsList
              patientId={subjectId}
              refillCoordinationEnabled={refillCoordinationEnabled ?? false}
              canStop
            />
          </FeatureAnchor>
          <FeatureAnchor id="add-medication">
            <AddMedicationForm patientId={subjectId} source="patient" />
          </FeatureAnchor>
        </div>

        <div className="space-y-4">
          <FeatureAnchor id="todays-doses">
            <TodaysDoses patientId={subjectId} />
          </FeatureAnchor>
          <FeatureAnchor id="adherence">
            <AdherenceCheckins patientId={subjectId} />
          </FeatureAnchor>
          {/* Patients buy from any pharmacy now, so nobody here sees the box.
              Reads it back and compares it with what was prescribed — and points
              at NAFDAC for the authenticity question we cannot answer. */}
          <FeatureAnchor id="check-my-pack">
            <CheckMyPack />
          </FeatureAnchor>
          <FeatureAnchor id="lab-monitoring">
            <LabMonitoringCard patientId={subjectId} />
          </FeatureAnchor>
        </div>
      </div>
      {/* Pharmacy ORDERING is dormant while no pharmacy partner is
          contracted: patients buy wherever suits them and record it on the
          medication itself. PharmacyCatalogue/PharmacyOrdersList are kept
          unmounted rather than deleted, so contracting a partner is a matter
          of rendering them again. Everything that makes chronic medication
          work — refill reminders, adherence check-ins, the missed-dose
          ladder, reviews, drug-class lab monitoring — is above and untouched,
          because none of it needs a partner. */}
    </DashboardSection>
  );
}
