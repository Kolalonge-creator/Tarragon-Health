import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { daysSince } from "@/lib/billing/fx-review";
import { CurrencyRateManager, type DerivedRow } from "./diaspora-pricing-manager";

type PriceRow = {
  code: string;
  name: string;
  interval: string;
  price_minor: number;
  currency: string;
  derived_from_code: string | null;
  stripe_price_id: string | null;
  is_active: boolean;
};

export default async function DiasporaPricingPage() {
  const profile = await getCurrentProfile();
  // proxy.ts already blocks non-admins from /admin/**; defence in depth.
  if (profile?.role !== "admin") redirect("/admin");

  const supabase = await createClient();

  const { data: settings } = await supabase
    .from("platform_currency_settings")
    .select("ngn_per_usd, updated_at")
    .eq("id", true)
    .maybeSingle();

  const updatedAt = settings?.updated_at ?? null;

  const [{ data: plans }, { data: addOns }] = await Promise.all([
    supabase
      .from("subscription_plans")
      .select("code, name, interval, price_minor, currency, derived_from_code, stripe_price_id, is_active"),
    supabase
      .from("add_ons")
      .select("code, name, interval, price_minor, currency, derived_from_code, stripe_price_id, is_active"),
  ]);

  const all: PriceRow[] = [...(plans ?? []), ...(addOns ?? [])];

  const nairaPrice = new Map<string, number>();
  for (const r of all) if (r.currency === "NGN") nairaPrice.set(r.code, r.price_minor);

  const rows: DerivedRow[] = all
    .flatMap((r) => {
      if (!r.derived_from_code) return [];
      const base = nairaPrice.get(r.derived_from_code);
      if (base === undefined) return [];
      return [
        {
          code: r.code,
          name: r.name,
          interval: r.interval,
          currency: r.currency as "USD",
          nairaMinor: base,
          currentMinor: r.price_minor,
          needsSync: r.stripe_price_id === null,
          isActive: r.is_active,
        },
      ];
    })
    .sort((a, b) => a.currency.localeCompare(b.currency) || a.nairaMinor - b.nairaMinor);

  // Diaspora-only tiers have no naira parent, so they sit outside the single
  // price list. Surfaced rather than hidden — an unpriced tier is a decision
  // waiting to be made, not a detail.
  const unlinked = all
    .filter((r) => r.currency !== "NGN" && !r.derived_from_code)
    .map((r) => ({ code: r.code, name: r.name, isActive: r.is_active }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Currency &amp; diaspora pricing
        </h1>
        <p className="max-w-3xl text-charcoal-ink/60">
          One price list. Every plan and add-on is priced once, in naira; the
          dollar amounts are that same price converted at the rate below.
          Nobody pays more for the same thing because of where they are. The
          currency is only how they pay.
        </p>
      </div>
      <CurrencyRateManager
        initialUsd={settings?.ngn_per_usd == null ? null : Number(settings.ngn_per_usd)}
        updatedAtLabel={
          updatedAt
            ? new Date(updatedAt).toLocaleString("en-GB", {
                dateStyle: "medium",
                timeStyle: "short",
              })
            : null
        }
        daysSinceReview={daysSince(updatedAt)}
        rows={rows}
        unlinked={unlinked}
      />
    </div>
  );
}
