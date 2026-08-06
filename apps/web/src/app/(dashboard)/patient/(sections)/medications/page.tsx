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
      <TodaysDoses patientId={subjectId} />
      <MedicationsList
        patientId={subjectId}
        refillCoordinationEnabled={refillCoordinationEnabled ?? false}
        canStop
      />
      <AdherenceCheckins patientId={subjectId} />
      {/* Patients buy from any pharmacy now, so nobody here sees the box.
          Reads it back and compares it with what was prescribed — and points
          at NAFDAC for the authenticity question we cannot answer. */}
      <CheckMyPack />
      <LabMonitoringCard patientId={subjectId} />
      <AddMedicationForm patientId={subjectId} source="patient" />
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
