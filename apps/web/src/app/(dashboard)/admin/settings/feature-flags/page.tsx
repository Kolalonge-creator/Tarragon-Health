import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { FeatureFlagsManager } from "./feature-flags-manager";

export default async function FeatureFlagsSettingsPage() {
  const profile = await getCurrentProfile();
  const { isSuperAdmin, keys } = await getCallerPermissions();

  // proxy.ts already blocks non-admins from any /admin/** route at the routing layer — this
  // is defense-in-depth on top of that, matching the other admin settings pages.
  if (!profile || (!isSuperAdmin && !keys.has("feature_flags.manage"))) {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Feature flags"
        description="Roll a feature out to internal staff, a percentage of patients, or a named cohort without a redeploy or a new migration per gate."
      />
      <FeatureFlagsManager />
    </div>
  );
}
