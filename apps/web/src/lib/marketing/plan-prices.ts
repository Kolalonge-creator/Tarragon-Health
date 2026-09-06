import { marketingAnonClient } from "./anon-client";
import { PAID_SERVICES } from "@/app/(marketing)/_content/pricing";

/**
 * Live prices for the public pricing page.
 *
 * One naira price list. The pricing page must never ship a hardcoded price
 * string as the truth: it would advertise one number while checkout charged
 * another. USD is gone with the diaspora tier (2026-07-31) — someone abroad
 * sponsors another person's care in naira, they are not a patient tier.
 *
 * Reads the public_price_list() RPC through the shared marketing anon client
 * (lib/marketing/anon-client.ts): deliberately not @/lib/supabase/server, so
 * the marketing tree stays free of auth and platform modules per the
 * marketing-boundary rule. This loader used to be the only one that accepted
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as well as ..._ANON_KEY; that
 * both-names handling now lives in the shared helper, so every marketing
 * loader survives the same key rename. The RPC reads service_products
 * (not the retired subscription_plans/add_ons — see
 * 20260902002938_public_price_list_reads_service_products.sql) and returns
 * only on-sale rows, and only code/currency/access_duration_days/price,
 * never features or provider ids.
 *
 * Returns an empty map on any failure. Callers fall back to the static copy in
 * _content/pricing.ts, so a network blip degrades to slightly stale prices
 * rather than a blank pricing page.
 */

export type PlanPriceMap = Map<string, number>;

export async function fetchPlanPrices(): Promise<PlanPriceMap> {
  const supabase = marketingAnonClient();
  if (!supabase) return new Map();

  try {
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
 * Which service_products rows back each pricing-page tier.
 *
 * The marketing tier ids and the product codes were named independently and
 * do not line up (`prevent` is backed by `prevent_pack`), so the mapping is
 * written out rather than derived. A tier missing from here simply keeps its
 * static price. "monthly"/"yearly" here means the 30-day vs 365-day pack
 * (service_products.access_duration_days), not a recurring billing interval
 * — nothing in this catalogue auto-renews.
 *
 * The three diaspora (USD) entries are deliberately kept even though no
 * `prevent_usd_pack`/`essential_usd_pack`/`complete_usd_pack` rows exist in
 * service_products yet (as of 2026-09-02, the only live USD product is
 * `lifestyle-coaching_usd_pack`) — this is safe (fetchPlanPrices' map simply
 * won't have these keys, so the diaspora tier cards fall back to their
 * static price, same as today), and documents the intended codes for
 * whoever adds those rows next rather than leaving the mapping silently
 * incomplete.
 */
/**
 * Live price strings for the paid services, keyed by service_products.code.
 *
 * Replaced the old TIER_PLAN_CODES map when the Prevent/Essential/Complete
 * packs were retired. That map was also where the diaspora bug lived: it
 * pointed three tiers at prevent_usd_pack / essential_usd_pack /
 * complete_usd_pack, none of which ever existed in service_products, so the
 * page fell back to static dollar strings and advertised prices nobody could
 * buy. Reading the codes off PAID_SERVICES means a service can only be priced
 * here if it is actually listed, and only overridden if it is actually on sale.
 */
export function servicePriceOverridesFrom(prices: PlanPriceMap): Record<string, string> {
  if (prices.size === 0) return {};

  const out: Record<string, string> = {};
  for (const service of PAID_SERVICES) {
    const price = prices.get(service.code);
    if (price !== undefined) {
      out[service.code] = formatPrice(price, "NGN");
    }
  }
  return out;
}

export async function fetchServicePriceOverrides(): Promise<Record<string, string>> {
  return servicePriceOverridesFrom(await fetchPlanPrices());
}
