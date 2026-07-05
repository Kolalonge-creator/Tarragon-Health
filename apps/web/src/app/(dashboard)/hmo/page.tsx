import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";

export default async function HmoPage() {
  const profile = await getCurrentProfile();

  return (
    <DashboardPlaceholder
      greeting={`Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`}
      roleLabel="HMO admin"
      comingUp={[
        "Member population risk distribution",
        "Care gap tracking across enrolled members",
        "Outcome / claims-prevented reporting",
        "Capitation contract status",
      ]}
    />
  );
}
