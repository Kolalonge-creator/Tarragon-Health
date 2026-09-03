import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader
        title="Commission tracking"
        description="Every lab, pharmacy, and specialist-referral commission Tarragon has earned from its partner network, auto-recorded the moment an order's payment is confirmed."
      />
      <CommissionsDashboard />
    </div>
  );
}
