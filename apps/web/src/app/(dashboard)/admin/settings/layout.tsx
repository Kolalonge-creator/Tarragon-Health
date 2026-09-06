import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { getVisibleAdminSettingsTabs } from "@/lib/admin-settings-nav";
import { SettingsTabs } from "@/components/shell/settings-tabs";

/**
 * Shared chrome for every `/admin/settings/*` page — a persistent top tab
 * bar grouping the ~28 settings pages into 7 sections, so the main sidebar
 * only needs one "Settings" entry instead of scattering them across it (and
 * a second, overlapping list of them on the /admin home page). Each tab's
 * visible items already mirror the destination page's own real permission
 * gate (see admin-settings-nav.ts) so nothing shown here is a dead link.
 */
export default async function AdminSettingsLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const perms = await getCallerPermissions();
  const tabs = getVisibleAdminSettingsTabs(perms);
  if (tabs.length === 0) redirect("/admin");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Settings</h1>
        <p className="text-charcoal-ink/60">
          Configure every part of the platform, grouped the way your team actually works.
        </p>
      </div>
      <SettingsTabs
        tabs={tabs.map((tab) => ({
          key: tab.key,
          label: tab.label,
          href: tab.href,
          matchHrefs: [tab.href, ...tab.items.map((item) => item.href)],
        }))}
      />
      <div>{children}</div>
    </div>
  );
}
