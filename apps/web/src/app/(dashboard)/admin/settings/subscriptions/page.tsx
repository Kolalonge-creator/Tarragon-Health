import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { PlansManager } from "./plans-manager";
import { AddOnsManager } from "./add-ons-manager";
import { PriceAdjustmentManager } from "./price-adjustment-manager";

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
        title="Subscription plans & add-ons"
        description="Create, price, and activate the plans and add-on services patients can subscribe to."
      />
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">This page no longer controls live pricing.</p>
        <p className="mt-1">
          Since the 2026-09-02 pay-per-service cutover, what a patient actually pays comes from{" "}
          <code className="rounded bg-amber-100 px-1 py-0.5">service_products</code> (read via{" "}
          <code className="rounded bg-amber-100 px-1 py-0.5">public_price_list()</code>), not the{" "}
          <code className="rounded bg-amber-100 px-1 py-0.5">subscription_plans</code>/
          <code className="rounded bg-amber-100 px-1 py-0.5">add_ons</code> tables this page reads and
          writes below. Creating, pricing, or syncing a plan or add-on here (including to Paystack)
          changes nothing for patients. There is currently no admin UI for{" "}
          <code className="rounded bg-amber-100 px-1 py-0.5">service_products</code> pricing; it is
          managed directly in the database until one is built.
        </p>
      </div>
      <PriceAdjustmentManager />
      <PlansManager />
      <AddOnsManager />
    </div>
  );
}
