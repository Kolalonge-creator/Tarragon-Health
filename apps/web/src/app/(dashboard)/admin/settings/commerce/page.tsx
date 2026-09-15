import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { getVisibleItemsForTab } from "@/lib/admin-settings-nav";
import { SettingsHubGrid } from "@/components/shell/settings-hub-grid";

export default async function CommerceSettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const perms = await getCallerPermissions();
  const items = getVisibleItemsForTab("commerce", perms);
  if (items.length === 0) redirect("/admin/settings");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">Commerce & Billing</h2>
        <p className="text-charcoal-ink/60">Plans, pricing, and prepaid care vouchers.</p>
      </div>
      <SettingsHubGrid items={items} />
    </div>
  );
}
