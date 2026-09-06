import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader
        title="Service regions (state rollout)"
        description="Turn TarragonHealth on one state at a time. Registration and the free / self-service tier work everywhere regardless. This switch only controls the partner-dependent actions (lab tests, pharmacy, home collection, delivery). A state also needs an active partner for a given service before that service goes live there. Activating a state automatically notifies everyone waiting for it."
      />
      <ServiceRegionsManager />
    </div>
  );
}
