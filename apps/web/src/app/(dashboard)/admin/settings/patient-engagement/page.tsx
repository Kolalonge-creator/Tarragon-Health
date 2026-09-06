import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { getVisibleItemsForTab } from "@/lib/admin-settings-nav";
import { SettingsHubGrid } from "@/components/shell/settings-hub-grid";

export default async function PatientEngagementSettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const perms = await getCallerPermissions();
  const items = getVisibleItemsForTab("patient-engagement", perms);
  if (items.length === 0) redirect("/admin/settings");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">Patient Engagement</h2>
        <p className="text-charcoal-ink/60">
          Campaigns, reminders, and the AI coach that keep patients engaged between visits.
        </p>
      </div>
      <SettingsHubGrid items={items} />
    </div>
  );
}
