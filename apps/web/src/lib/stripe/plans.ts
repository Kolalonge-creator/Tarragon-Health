import { stripeCall, type StripeResult } from "./client";
import type { Enums } from "@tarragon/shared";

type BillingInterval = Enums<"billing_interval">;

/**
 * Stripe has no standalone "Plan" object for new integrations (Plans are the
 * legacy predecessor to Product+Price) — creates a Product then a recurring
 * Price on it, mirroring createPaystackPlan()'s role. Idempotency is the
 * caller's job — pass the row's existing `stripe_price_id` and skip calling
 * this if it's already set (see `syncPlanToStripe`).
 */
export async function createStripePrice(args: {
  name: string;
  amountMinor: number;
  interval: BillingInterval;
  currency: "GBP" | "USD";
}): Promise<StripeResult<{ priceId: string; productId: string }>> {
  const productResult = await stripeCall((stripe) => stripe.products.create({ name: args.name }));
  if (!productResult.ok) return productResult;

  const priceResult = await stripeCall((stripe) =>
    stripe.prices.create({
      product: productResult.data.id,
      // Minor units directly (cents/pence) — same convention as price_minor
      // and Paystack's `amount`, no conversion needed.
      unit_amount: args.amountMinor,
      currency: args.currency.toLowerCase(),
      recurring: { interval: args.interval === "yearly" ? "year" : "month" },
    }),
  );
  if (!priceResult.ok) return priceResult;

  return { ok: true, data: { priceId: priceResult.data.id, productId: productResult.data.id } };
}

/**
 * Idempotent sync for a single plan/add-on row: no-op if it already has a
 * stripe_price_id, otherwise creates one. Returns the ids to persist — the
 * caller (a server action) writes them back to the subscription_plans/
 * add_ons row, since this module has no DB access. Mirrors
 * syncPlanToPaystack()'s contract exactly.
 */
export async function syncPlanToStripe(row: {
  stripe_price_id: string | null;
  stripe_product_id?: string | null;
  name: string;
  price_minor: number;
  interval: BillingInterval;
  currency: "NGN" | "GBP" | "USD";
}): Promise<StripeResult<{ priceId: string; productId: string }>> {
  if (row.stripe_price_id) {
    return { ok: true, data: { priceId: row.stripe_price_id, productId: row.stripe_product_id ?? "" } };
  }
  if (row.price_minor === 0) {
    return { ok: false, error: "Free plans do not need a Stripe price" };
  }
  if (row.currency === "NGN") {
    return { ok: false, error: "NGN plans sync to Paystack, not Stripe" };
  }
  return createStripePrice({
    name: row.name,
    amountMinor: row.price_minor,
    interval: row.interval,
    currency: row.currency,
  });
}
