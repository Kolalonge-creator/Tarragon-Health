import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";

export default async function ClinicianPage() {
  const profile = await getCurrentProfile();

  return (
    <DashboardPlaceholder
      greeting={`Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`}
      roleLabel="Clinician"
      comingUp={[
        "Escalation homepage — patients awaiting doctor review",
        "Escalated patient summary: recent vitals, meds, labs",
        "Review note + action plan",
        "Close-escalation function",
        "Doctor-to-nurse handover",
      ]}
    />
  );
}
