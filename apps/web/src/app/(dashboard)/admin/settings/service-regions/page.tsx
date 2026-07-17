import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { ServiceRegionsManager } from "./service-regions-manager";

export default async function ServiceRegionsSettingsPage() {
  const profile = await getCurrentProfile();

  // proxy.ts already blocks non-admins from any /admin/** route at the routing layer — this
  // is defense-in-depth on top of that, matching the other admin settings pages.
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Service regions (state rollout)
        </h1>
        <p className="text-charcoal-ink/60">
          Turn TarragonHealth on one state at a time. Registration and the free / self-service
          tier work everywhere regardless — this switch only controls the partner-dependent
          actions (lab tests, pharmacy, home collection, delivery). A state also needs an active
          partner for a given service before that service goes live there. Activating a state
          automatically notifies everyone waiting for it.
        </p>
      </div>
      <ServiceRegionsManager />
    </div>
  );
}
