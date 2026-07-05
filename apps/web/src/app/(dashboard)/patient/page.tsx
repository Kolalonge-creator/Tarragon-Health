import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { VitalsForm } from "./vitals-form";
import { VitalsHistory } from "./vitals-history";

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
        "Medication schedule + refill reminders",
        "Preventive screening calendar",
        "Care plan (once a clinician assigns one)",
        "Health Passport download",
      ]}
    >
      <VitalsForm patientId={profile.id} />
      <VitalsHistory patientId={profile.id} />
    </DashboardPlaceholder>
  );
}
