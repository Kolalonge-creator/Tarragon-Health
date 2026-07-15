import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";

export default async function CareCoordinatorPage() {
  const profile = await getCurrentProfile();
  const greeting = `Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`;

  return (
    <DashboardPlaceholder
      greeting={greeting}
      roleLabel="Care Coordinator"
      comingUp={[
        "Adherence and missed-reading worklist",
        "Lab and pharmacy refill booking",
        "Patient check-in call/WhatsApp threads",
      ]}
    />
  );
}
