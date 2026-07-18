/**
 * Server-only Stripe client (GBP/USD diaspora payments — see CLAUDE.md
 * "Diaspora billing: GBP primary, USD secondary, via Stripe"). Never import
 * this from a "use client" file — it holds STRIPE_SECRET_KEY.
 *
 * Unlike apps/web/src/lib/paystack/client.ts's hand-rolled fetch wrapper,
 * this uses the official `stripe` npm package — it's typed and handles
 * retries, which Paystack's REST API gave no good reason to reimplement by
 * hand for. The SDK throws on failure though, so lib/stripe/plans.ts and
 * lib/stripe/checkout.ts wrap every call in try/catch and normalize to the
 * same `{ok:true,data}|{ok:false,error}` shape Paystack's client returns —
 * callers (server actions) must never see a thrown Stripe.errors.StripeError.
 *
 * STRIPE_API_VERSION is pinned explicitly (rather than left to the
 * account's dashboard default) because Stripe's "Basil" API version
 * (2025-03-31+) moved current_period_end off the Subscription object onto
 * its line items — supabase/functions/stripe-webhook/index.ts is written
 * against that post-Basil shape, so client and webhook must agree on the
 * same version or the webhook's field paths won't match what a
 * differently-pinned checkout session produces.
 */
import Stripe from "stripe";

export const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2026-06-24.dahlia";

let client: Stripe | null = null;

function getSecretKey(): string | null {
  return process.env.STRIPE_SECRET_KEY || null;
}

/** True once STRIPE_SECRET_KEY is configured — callers use this to decide
 * whether to attempt a checkout at all, same pattern as isPaystackConfigured(). */
export function isStripeConfigured(): boolean {
  return getSecretKey() !== null;
}

export function getStripeClient(): Stripe | null {
  const secretKey = getSecretKey();
  if (!secretKey) return null;
  if (!client) {
    client = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION, typescript: true });
  }
  return client;
}

export type StripeResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Normalizes the SDK's throw-based error model into Paystack's result-object
 * convention — every lib/stripe/ call site goes through this rather than a
 * bare try/catch, so the "never throws" contract stays in exactly one place. */
export async function stripeCall<T>(fn: (stripe: Stripe) => Promise<T>): Promise<StripeResult<T>> {
  const stripe = getStripeClient();
  if (!stripe) {
    return { ok: false, error: "STRIPE_SECRET_KEY is not configured" };
  }
  try {
    const data = await fn(stripe);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown Stripe request failure",
    };
  }
}
