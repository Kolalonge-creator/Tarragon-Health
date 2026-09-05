import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { PlansManager } from "./plans-manager";
import { AddOnsManager } from "./add-ons-manager";

/**
 * Kept as a read-only archive rather than deleted.
 *
 * The screen used to create, price, activate and Paystack-sync subscription
 * plans and add-ons. All of that was retired by the 2026-09-02 pay-per-service
 * cutover, but the write path stayed live and could still mint real recurring
 * Paystack Plan objects that no patient checkout could charge against, so it
 * has been removed entirely. What is left is the history: the plans, what they
 * cost, and the provider references someone needs in order to disable those
 * Plan objects at Paystack by hand.
 */
export default async function SubscriptionsSettingsPage() {
  const profile = await getCurrentProfile();

  // proxy.ts already blocks non-admins from reaching any /admin/** route at
  // the routing layer — this is a defense-in-depth check on top of that.
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Retired subscription catalogue"
        description="What Tarragon used to sell as monthly plans, kept for the record."
      />
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Read-only. Subscriptions are no longer sold.</p>
        <p className="mt-1">
          Since the 2026-09-02 cutover the app is free and Tarragon charges per piece of doctor
          work, priced in{" "}
          <code className="rounded bg-amber-100 px-1 py-0.5">service_products</code> and read by{" "}
          <code className="rounded bg-amber-100 px-1 py-0.5">public_price_list()</code>. The
          controls that used to create, price, activate and sync plans here have been removed:
          they wrote to{" "}
          <code className="rounded bg-amber-100 px-1 py-0.5">subscription_plans</code>/
          <code className="rounded bg-amber-100 px-1 py-0.5">add_ons</code>, which nothing charges
          against, and the sync created live recurring Plan objects at Paystack.
        </p>
        <p className="mt-2">
          Paystack has no API for deleting a Plan, so the Plan objects listed below still exist
          upstream and have to be disabled in the Paystack dashboard by hand. There is still no
          admin UI for{" "}
          <code className="rounded bg-amber-100 px-1 py-0.5">service_products</code> pricing; it is
          managed directly in the database until one is built.
        </p>
      </div>
      <PlansManager />
      <AddOnsManager />
    </div>
  );
}
