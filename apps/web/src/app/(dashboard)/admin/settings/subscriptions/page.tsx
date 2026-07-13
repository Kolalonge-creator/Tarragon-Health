import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PlansManager } from "./plans-manager";
import { AddOnsManager } from "./add-ons-manager";

export default async function SubscriptionsSettingsPage() {
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
          Subscription plans &amp; add-ons
        </h1>
        <p className="text-charcoal-ink/60">
          Create, price, and activate the plans and add-on services patients can subscribe to.
        </p>
      </div>
      <PlansManager />
      <AddOnsManager />
    </div>
  );
}
