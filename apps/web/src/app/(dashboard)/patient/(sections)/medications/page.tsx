import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import { TodaysDoses } from "@/app/(dashboard)/patient/todays-doses";
import { MedicationsList } from "@/app/(dashboard)/patient/medications-list";
import { AdherenceCheckins } from "@/app/(dashboard)/patient/adherence-checkins";
import { MedicationReconciliationConfirm } from "@/app/(dashboard)/patient/medication-reconciliation-confirm";
import { CheckMyPack } from "@/app/(dashboard)/patient/check-my-pack";
import { LabMonitoringCard } from "@/app/(dashboard)/patient/lab-monitoring-card";
import { MedicationEffectivenessCard } from "@/components/medication-effectiveness-card";
import { AddMedicationForm } from "@/app/(dashboard)/patient/add-medication-form";

export default async function PatientMedicationsPage() {
  const { subjectId } = await getPatientDashboardContext();

  return (
    <DashboardSection
      id="medications"
      title="Medications"
      description="Today's doses and your medicines cabinet."
      icon={SEMANTIC_ICON.medication}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr] lg:items-start">
        <div className="space-y-4">
          <MedicationsList
            patientId={subjectId}
            refillCoordinationEnabled
            canStop
          />
          <AddMedicationForm patientId={subjectId} source="patient" />
        </div>

        <div className="space-y-4">
          <TodaysDoses patientId={subjectId} />
          <MedicationReconciliationConfirm patientId={subjectId} />
          <AdherenceCheckins patientId={subjectId} />
          {/* Patients buy from any pharmacy now, so nobody here sees the box.
              Reads it back and compares it with what was prescribed — and points
              at NAFDAC for the authenticity question we cannot answer. */}
          <CheckMyPack />
          <LabMonitoringCard patientId={subjectId} />
          <MedicationEffectivenessCard patientId={subjectId} />
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
