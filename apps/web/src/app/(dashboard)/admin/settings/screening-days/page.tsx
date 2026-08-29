import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
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
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Group screening days
        </h1>
        <p className="text-charcoal-ink/60">
          Confirm a discounted price for a church, market association, cooperative, or SME&apos;s
          bulk booking, then issue each attendee their own named voucher once the group has paid
          in full. Getting the phlebotomist to the venue on the day stays a manual call to Synlab —
          this only tracks the booking and the money.
        </p>
      </div>
      <ScreeningDaysDashboard />
    </div>
  );
}
