import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { OutreachWorklist } from "@/components/clinical/outreach-worklist";

export default async function CareCoordinatorPage() {
  const profile = await getCurrentProfile();
  const greeting = `Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`;

  return (
    <DashboardPlaceholder
      greeting={greeting}
      roleLabel="Care Coordinator"
      comingUp={[
        "Lab and pharmacy refill booking",
        "Patient check-in call/WhatsApp threads",
      ]}
    >
      <OutreachWorklist />
    </DashboardPlaceholder>
  );
}
