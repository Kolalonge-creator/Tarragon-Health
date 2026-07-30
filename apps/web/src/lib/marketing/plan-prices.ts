import { createClient } from "@supabase/supabase-js";

/**
 * Live prices for the public pricing page.
 *
 * One price list (v3 §15): the dollar amount is the naira price converted at
 * the admin-set reference rate. When the founder changes that
 * rate the derived prices move, so the marketing page cannot keep shipping
 * hardcoded strings — it would advertise one number while checkout charged
 * another.
 *
 * Reads the public_price_list() RPC through a BARE anon supabase-js client,
 * following lib/marketing/resources-data.ts: deliberately not
 * @/lib/supabase/server, so the marketing tree stays free of auth and platform
 * modules per the marketing-boundary rule. The RPC returns only on-sale rows
 * and only code/currency/interval/price, never features or provider ids.
 *
 * Returns an empty map on any failure. Callers fall back to the static copy in
 * _content/pricing.ts, so a network blip degrades to slightly stale prices
 * rather than a blank pricing page.
 */

export type PlanPriceMap = Map<string, number>;

export async function fetchPlanPrices(): Promise<PlanPriceMap> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return new Map();

  try {
    const supabase = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supabase.rpc("public_price_list");
    if (error || !data) return new Map();

    const map: PlanPriceMap = new Map();
    for (const row of data as { code: string; price_minor: number }[]) {
      map.set(row.code, row.price_minor);
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Formats a minor-unit amount the way the pricing page writes prices: no
 * decimals when the amount is whole, which it almost always is.
 */
export function formatPrice(minor: number, currency: "NGN" | "USD"): string {
  const symbol = currency === "NGN" ? "₦" : "$";
  const major = minor / 100;
  const hasPence = Math.round(major * 100) % 100 !== 0;
  return `${symbol}${major.toLocaleString(undefined, {
    minimumFractionDigits: hasPence ? 2 : 0,
    maximumFractionDigits: hasPence ? 2 : 0,
  })}`;
}

/**
 * Which subscription_plans rows back each pricing-page tier.
 *
 * The marketing tier ids and the plan codes were named independently and do
 * not line up (`diaspora-complete` is backed by `complete_usd`), so the mapping
 * is written out rather than derived. A tier missing from here simply keeps its
 * static price.
 */
const TIER_PLAN_CODES: Record<string, { monthly?: string; yearly?: string; currency: "NGN" | "USD" }> = {
  // Naira
  free: { monthly: "free", currency: "NGN" },
  prevent: { monthly: "prevent", yearly: "prevent_yearly", currency: "NGN" },
  essential: { monthly: "essential", yearly: "essential_yearly", currency: "NGN" },
  complete: { monthly: "complete", yearly: "complete_yearly", currency: "NGN" },
  // Dollars — every one of these is its naira row above, converted.
  "diaspora-prevent": { monthly: "prevent_usd", yearly: "prevent_yearly_usd", currency: "USD" },
  "diaspora-essential": { monthly: "essential_usd", yearly: "essential_yearly_usd", currency: "USD" },
  "diaspora-complete": { monthly: "complete_usd", yearly: "complete_yearly_usd", currency: "USD" },
};

export type TierPriceOverride = { priceMain?: string; priceSecondary?: string };

/**
 * Builds the per-tier price strings from live data. Only tiers whose backing
 * plan is actually on sale get an override; anything unpriced, off sale or
 * unreachable keeps the static string, so the page never shows a blank or a
 * zero where a price belongs.
 */
export async function fetchTierPriceOverrides(): Promise<Record<string, TierPriceOverride>> {
  const prices = await fetchPlanPrices();
  if (prices.size === 0) return {};

  const out: Record<string, TierPriceOverride> = {};
  for (const [tierId, spec] of Object.entries(TIER_PLAN_CODES)) {
    const monthly = spec.monthly ? prices.get(spec.monthly) : undefined;
    const yearly = spec.yearly ? prices.get(spec.yearly) : undefined;
    const override: TierPriceOverride = {};

    if (monthly !== undefined) {
      override.priceMain = formatPrice(monthly, spec.currency);
      if (yearly !== undefined) {
        override.priceSecondary = `or ${formatPrice(yearly, spec.currency)}/year`;
      }
    } else if (yearly !== undefined) {
      override.priceMain = formatPrice(yearly, spec.currency);
    }

    if (override.priceMain) out[tierId] = override;
  }
  return out;
}
