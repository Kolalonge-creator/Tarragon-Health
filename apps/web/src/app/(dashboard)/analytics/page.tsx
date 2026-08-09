import { getCurrentProfile } from "@/lib/auth/current-profile";
import { OverviewDashboard } from "./_components/overview-dashboard";

export default async function AnalyticsOverviewPage() {
  const profile = await getCurrentProfile();
  const firstName = profile?.full_name?.split(" ")[0] ?? null;

  return <OverviewDashboard firstName={firstName} />;
}
