import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { VitalsForm } from "./vitals-form";
import { VitalsHistory } from "./vitals-history";
import { MedicationsList } from "./medications-list";
import { TodaysDoses } from "./todays-doses";
import { AddMedicationForm } from "./add-medication-form";

export default async function PatientPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }

  return (
    <DashboardPlaceholder
      greeting={`Hi${profile.full_name ? `, ${profile.full_name}` : ""}`}
      roleLabel="Patient"
      comingUp={[
        "Preventive screening calendar",
        "Care plan (once a clinician assigns one)",
        "Health Passport download",
      ]}
    >
      <VitalsForm patientId={profile.id} />
      <VitalsHistory patientId={profile.id} />
      <TodaysDoses patientId={profile.id} />
      <MedicationsList patientId={profile.id} />
      <AddMedicationForm patientId={profile.id} source="patient" />
    </DashboardPlaceholder>
  );
}
