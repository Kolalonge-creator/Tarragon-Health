import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { Worklist } from "./worklist";

export default async function ClinicianPage() {
  const profile = await getCurrentProfile();

  return (
    <DashboardPlaceholder
      greeting={`Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`}
      roleLabel="Clinician"
      comingUp={[
        "Call note form + next follow-up date",
        "Escalation homepage — patients awaiting review, escalated summary, action plan",
        "Close-escalation function",
        "Workload metrics (1:120 ratio target)",
      ]}
    >
      <Worklist />
    </DashboardPlaceholder>
  );
}
