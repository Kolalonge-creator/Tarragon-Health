import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";

export default async function NursePage() {
  const profile = await getCurrentProfile();

  return (
    <DashboardPlaceholder
      greeting={`Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`}
      roleLabel="Nurse"
      comingUp={[
        "Daily worklist: abnormal readings, missed meds, labs due",
        "Priority 1 alerts — abnormal screening result upgrades (4-hour SLA)",
        "Call note form + next follow-up date",
        "Escalation button to doctor review",
        "Workload metrics (1:120 ratio target)",
      ]}
    />
  );
}
