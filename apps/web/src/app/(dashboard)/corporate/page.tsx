import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";

export default async function CorporatePage() {
  const profile = await getCurrentProfile();

  return (
    <DashboardPlaceholder
      greeting={`Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`}
      roleLabel="Corporate admin"
      comingUp={[
        "Staff enrolment",
        "Workforce health — cohort risk distribution",
        "Screening compliance %",
        "Abnormal findings (anonymised) + overdue-screen actions",
      ]}
    />
  );
}
