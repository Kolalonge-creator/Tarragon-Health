import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { CommissionsDashboard } from "./commissions-dashboard";

export default async function CommissionsSettingsPage() {
  const profile = await getCurrentProfile();

  // proxy.ts already blocks non-admins from reaching any /admin/** route at
  // the routing layer — this is a defense-in-depth check on top of that.
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Commission tracking</h1>
        <p className="text-charcoal-ink/60">
          Every lab, pharmacy, and specialist-referral commission Tarragon has earned from its
          partner network, auto-recorded the moment an order&apos;s payment is confirmed.
        </p>
      </div>
      <CommissionsDashboard />
    </div>
  );
}
