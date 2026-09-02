import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { OpsConsoleManager } from "./ops-console-manager";

export default async function OpsConsoleSettingsPage() {
  const profile = await getCurrentProfile();
  const { isSuperAdmin, keys } = await getCallerPermissions();

  if (!profile || (!isSuperAdmin && !keys.has("ops.console.view"))) {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Operations console
        </h1>
        <p className="text-charcoal-ink/60">
          One cross-domain worklist — alerts, appointments, referrals, labs, pharmacy, support,
          payments, incidents, and provider governance, all in one place, worst first.
        </p>
      </div>
      <OpsConsoleManager />
    </div>
  );
}
