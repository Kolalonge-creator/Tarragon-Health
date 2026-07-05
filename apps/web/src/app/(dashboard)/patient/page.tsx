import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";

export default async function PatientPage() {
  const profile = await getCurrentProfile();

  return (
    <DashboardPlaceholder
      greeting={`Hi${profile?.full_name ? `, ${profile.full_name}` : ""}`}
      roleLabel="Patient"
      comingUp={[
        "Log BP, glucose, weight, pulse readings",
        "Medication schedule + refill reminders",
        "Preventive screening calendar",
        "Care plan (once a nurse assigns one)",
        "Health Passport download",
      ]}
    />
  );
}
