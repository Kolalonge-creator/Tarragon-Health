import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { getVisibleAdminSettingsTabs } from "@/lib/admin-settings-nav";

/** `/admin/settings` itself has no content of its own — it lands on whichever
 * tab the caller can actually see first, since that varies by what they've
 * been delegated. */
export default async function AdminSettingsIndexPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const perms = await getCallerPermissions();
  const tabs = getVisibleAdminSettingsTabs(perms);
  if (tabs.length === 0) redirect("/admin");

  redirect(tabs[0].href);
}
