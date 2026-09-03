import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { NotificationTemplatesManager } from "./notification-templates-manager";

export default async function NotificationTemplatesSettingsPage() {
  const profile = await getCurrentProfile();
  const { isSuperAdmin, keys } = await getCallerPermissions();

  if (!profile || (!isSuperAdmin && !keys.has("notification_templates.manage"))) {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Notification templates
        </h1>
        <p className="text-charcoal-ink/60">
          The catalogue of every notification the platform sends: what it&apos;s for, how
          urgent, which channels, and whether it needs Clinical Director sign-off.
        </p>
      </div>
      <NotificationTemplatesManager />
    </div>
  );
}
