import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { DiasporaPricingManager, type UsdPlanRow } from "./diaspora-pricing-manager";

export default async function DiasporaPricingPage() {
  const profile = await getCurrentProfile();
  // proxy.ts already blocks non-admins from /admin/**; defense in depth.
  if (profile?.role !== "admin") redirect("/admin");

  const supabase = await createClient();

  const { data: settings } = await supabase
    .from("platform_currency_settings")
    .select("usd_per_gbp")
    .eq("id", true)
    .maybeSingle();

  const { data: plans } = await supabase
    .from("subscription_plans")
    .select("code, name, interval, price_minor, currency, stripe_price_id")
    .in("currency", ["GBP", "USD"]);

  const gbpByCode = new Map(
    (plans ?? [])
      .filter((p) => p.currency === "GBP")
      .map((p) => [p.code, p.price_minor])
  );

  const rows: UsdPlanRow[] = (plans ?? [])
    .filter((p) => p.currency === "USD")
    .map((p) => {
      const gbpMinor = gbpByCode.get(p.code.replace(/_usd$/, "_gbp")) ?? null;
      return {
        code: p.code,
        name: p.name,
        interval: p.interval,
        currentUsdMajor: p.price_minor / 100,
        gbpMajor: gbpMinor === null ? null : gbpMinor / 100,
        needsStripeSync: p.stripe_price_id === null,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Diaspora pricing (USD)
        </h1>
        <p className="max-w-2xl text-charcoal-ink/60">
          Keep the USD diaspora prices in step with the GBP prices. Set the
          GBP&nbsp;→&nbsp;USD reference rate, apply it to fill suggested USD
          prices, adjust any individually, and save. This never charges anyone
          automatically — after saving, re-run &ldquo;Sync to Stripe&rdquo; on
          the Subscriptions page so the new amounts are the ones actually
          charged.
        </p>
      </div>
      <DiasporaPricingManager
        initialRate={Number(settings?.usd_per_gbp ?? 1.34)}
        rows={rows}
      />
    </div>
  );
}
