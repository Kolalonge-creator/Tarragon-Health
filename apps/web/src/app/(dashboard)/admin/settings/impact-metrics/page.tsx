import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasAnyPermission } from "@/lib/auth/permissions";
import { ImpactMetricsManager } from "./impact-metrics-manager";

export default async function ImpactMetricsSettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  if (!(await hasAnyPermission("impact_metrics.manage"))) {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Public impact dashboard
        </h1>
        <p className="text-charcoal-ink/60">
          Controls what shows on the public <code>/impact</code> page. Every value is a real
          platform-wide count, refreshed nightly; anything under 25 is held back automatically to
          protect patient privacy. Hiding a row here is a separate, manual kill switch on top of
          that.
        </p>
      </div>
      <ImpactMetricsManager />
    </div>
  );
}
