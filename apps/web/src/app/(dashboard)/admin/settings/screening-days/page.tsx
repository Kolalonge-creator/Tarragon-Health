import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { ScreeningDaysDashboard } from "./screening-days-dashboard";

export const metadata = { title: "Group screening days" };

export default async function ScreeningDaysSettingsPage() {
  const profile = await getCurrentProfile();

  // proxy.ts already blocks non-admins from reaching any /admin/** route at
  // the routing layer — this is a defence-in-depth check on top of that.
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Group screening days"
        description="Run outreach health checks for churches, companies and associations: a free community check (readings on the day and a lab form for any laboratory) or a paid check that adds one results consultation. Enrol each attendee to their own account, then save their readings. Older test-bundle days still confirm a discounted price and issue each attendee a voucher once the group has paid."
      />
      <ScreeningDaysDashboard />
    </div>
  );
}
