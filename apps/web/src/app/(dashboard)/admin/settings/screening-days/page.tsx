import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { ScreeningDaysDashboard } from "./screening-days-dashboard";

export default async function ScreeningDaysSettingsPage() {
  const profile = await getCurrentProfile();

  // proxy.ts already blocks non-admins from reaching any /admin/** route at
  // the routing layer — this is a defense-in-depth check on top of that.
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Group screening days"
        description="Confirm a discounted price for a church, market association, cooperative, or SME's bulk booking, then issue each attendee their own named voucher once the group has paid in full. Getting the phlebotomist to the venue on the day stays a manual call to Synlab. This only tracks the booking and the money."
      />
      <ScreeningDaysDashboard />
    </div>
  );
}
