import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";

export default async function ClinicianPage() {
  const profile = await getCurrentProfile();

  return (
    <DashboardPlaceholder
      greeting={`Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`}
      roleLabel="Clinician"
      comingUp={[
        "Daily worklist: abnormal readings, missed meds, labs due",
        "Priority 1 alerts — abnormal screening result upgrades (4-hour SLA)",
        "Call note form + next follow-up date",
        "Escalation homepage — patients awaiting review, escalated summary, action plan",
        "Close-escalation function",
        "Workload metrics (1:120 ratio target)",
      ]}
    />
  );
}
