import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { NotificationTemplatesManager } from "./notification-templates-manager";

export default async function NotificationTemplatesSettingsPage() {
  const profile = await getCurrentProfile();
  const { isSuperAdmin, keys } = await getCallerPermissions();

  if (!profile || (!isSuperAdmin && !keys.has("notification_templates.manage"))) {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notification templates"
        description="The catalogue of every notification the platform sends: what it's for, how urgent, which channels, and whether it needs Clinical Director sign-off."
      />
      <NotificationTemplatesManager />
    </div>
  );
}
