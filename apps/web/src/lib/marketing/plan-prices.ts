import { createClient } from "@supabase/supabase-js";
import { DIASPORA_PROCESSING_FEE_NOTE_SHORT } from "@/app/(marketing)/_content/pricing";

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
 * not line up, so the mapping is written out rather than derived. A tier
 * missing from here simply keeps its static price.
 *
 * Superseded 2026-08-29: Prevent/Essential/Complete (+ their _usd derived
 * rows) are retired — removed from here, not left as dead entries, since
 * `public_price_list()` only returns on-sale rows anyway and their marketing
 * tier ids ('prevent'/'essential'/'complete') no longer exist in NGN_TIERS/
 * USD_TIERS. Replaced by care_pass_12mo (handled separately below, not
 * through this monthly/yearly-shaped map — Care Pass's two rows are two
 * one-off terms on ONE card, not a recurring monthly/yearly pair) and
 * family_watch/family_watch_plus, which DO fit this shape.
 */
const TIER_PLAN_CODES: Record<string, { monthly?: string; yearly?: string; currency: "NGN" | "USD" }> = {
  free: { monthly: "free", currency: "NGN" },
  family_watch: { monthly: "family_watch", yearly: "family_watch_yearly", currency: "USD" },
  family_watch_plus: { monthly: "family_watch_plus", yearly: "family_watch_plus_yearly", currency: "USD" },
};

export type TierPriceOverride = { priceMain?: string; priceSecondary?: string; priceNote?: string };

/**
 * Builds the per-tier price strings from live data. Only tiers whose backing
 * plan is actually on sale get an override; anything unpriced, off sale or
 * unreachable keeps the static string, so the page never shows a blank or a
 * zero where a price belongs.
 *
 * Naira tiers lead with the monthly price, matching how they're always sold.
 * Dollar tiers lead with the YEARLY price instead (one card charge a year
 * instead of twelve — matches the default onboarding and /patient/subscription
 * already use for USD) and carry a fee-disclosure note, since every dollar
 * price on sale already includes the 10% international processing fee
 * (private.expected_derived_price_minor). If only one interval is on sale
 * (e.g. mid-resync after a rate or fee change), that one becomes priceMain
 * rather than showing nothing.
 */
export async function fetchTierPriceOverrides(): Promise<Record<string, TierPriceOverride>> {
  const prices = await fetchPlanPrices();
  if (prices.size === 0) return {};

  const out: Record<string, TierPriceOverride> = {};

  // Care Pass: one card, two one-off terms — not a monthly/yearly pair, so
  // it doesn't fit the generic loop below (which assumes recurring
  // monthly/yearly and writes "/month"/"/year" suffixes accordingly).
  const twelveMo = prices.get("care_pass_12mo");
  const sixMo = prices.get("care_pass_6mo");
  if (twelveMo !== undefined) {
    const override: TierPriceOverride = { priceMain: formatPrice(twelveMo, "NGN") };
    if (sixMo !== undefined) {
      override.priceSecondary = `or ${formatPrice(sixMo, "NGN")} for 6 months`;
    }
    out.care_pass_12mo = override;
  }

  for (const [tierId, spec] of Object.entries(TIER_PLAN_CODES)) {
    const monthly = spec.monthly ? prices.get(spec.monthly) : undefined;
    const yearly = spec.yearly ? prices.get(spec.yearly) : undefined;
    const override: TierPriceOverride = {};

    if (spec.currency === "USD") {
      if (yearly !== undefined) {
        override.priceMain = formatPrice(yearly, spec.currency);
        if (monthly !== undefined) {
          override.priceSecondary = `or ${formatPrice(monthly, spec.currency)}/month`;
        }
      } else if (monthly !== undefined) {
        override.priceMain = formatPrice(monthly, spec.currency);
      }
      if (override.priceMain) override.priceNote = DIASPORA_PROCESSING_FEE_NOTE_SHORT;
    } else if (monthly !== undefined) {
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
