import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
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
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Feature flags</h1>
        <p className="text-charcoal-ink/60">
          Roll a feature out to internal staff, a percentage of patients, or a named cohort
          without a redeploy or a new migration per gate.
        </p>
      </div>
      <FeatureFlagsManager />
    </div>
  );
}
