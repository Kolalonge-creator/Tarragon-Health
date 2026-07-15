import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { LogisticsPartnersManager } from "./logistics-partners-manager";

export default async function LogisticsPartnersSettingsPage() {
  const profile = await getCurrentProfile();

  // proxy.ts already blocks non-admins from reaching any /admin/** route at
  // the routing layer — this is a defense-in-depth check on top of that.
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Home visit &amp; delivery partners
        </h1>
        <p className="text-charcoal-ink/60">
          There is no feature flag for home collection or delivery — patients see a real
          scheduling/tracking UI the moment an active partner row exists covering their region.
          Adding or activating a row below is the entire mechanism.
        </p>
      </div>
      <LogisticsPartnersManager />
    </div>
  );
}
