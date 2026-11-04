import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasAnyPermission, hasPermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { ScreeningDaysDashboard } from "./screening-days-dashboard";

export const metadata = { title: "Group screening days" };

export default async function ScreeningDaysSettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  // An outreach partner holding screening_days.run reaches this page through the delegated /admin door (proxy.ts) and runs
  // the day: register, enrol, save readings. Creating and pricing days stays with screening_days.manage (and the admin).
  if (!(await hasAnyPermission("screening_days.manage", "screening_days.run"))) {
    redirect("/admin");
  }
  const canManage = await hasPermission("screening_days.manage");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Group screening days"
        description="Run outreach health checks for churches, companies and associations: a free community check (readings on the day and a lab form for any laboratory) or a paid check that adds one results consultation. Enrol each attendee to their own account, then save their readings. Older test-bundle days still confirm a discounted price and issue each attendee a voucher once the group has paid."
      />
      <ScreeningDaysDashboard canManage={canManage} />
    </div>
  );
}
