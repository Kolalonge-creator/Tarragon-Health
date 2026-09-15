import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { getVisibleItemsForTab } from "@/lib/admin-settings-nav";
import { SettingsHubGrid } from "@/components/shell/settings-hub-grid";

export default async function AccessSettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const perms = await getCallerPermissions();
  const items = getVisibleItemsForTab("access", perms);
  if (items.length === 0) redirect("/admin/settings");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">People & Access</h2>
        <p className="text-charcoal-ink/60">
          Staff logins, delegated capabilities, and every credentialed clinician on the platform.
        </p>
      </div>
      <SettingsHubGrid items={items} />
    </div>
  );
}
