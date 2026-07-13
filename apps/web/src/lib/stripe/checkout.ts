import { stripeCall, type StripeResult } from "./client";
import type { CheckoutMetadata } from "@/lib/billing/checkout-metadata";

/**
 * Starts a hosted-checkout redirect flow: the browser is sent to
 * `checkoutUrl`, Stripe collects card details on its own page, and Stripe
 * redirects back to `successUrl?session_id={CHECKOUT_SESSION_ID}` when done.
 * Mirrors initializeTransaction()'s role for Paystack.
 *
 * `metadata` is set in BOTH places deliberately: session-level `metadata`
 * only lands on the Checkout Session object (read by stripe-webhook's
 * checkout.session.completed handler); it does NOT propagate to the
 * Subscription Stripe creates as part of completing the session. Setting
 * `subscription_data.metadata` too is what makes that same metadata readable
 * from customer.subscription.created/.updated — without it, the webhook's
 * enrichment step would have nothing to correlate a Stripe subscription id
 * back to a local row.
 */
export async function createCheckoutSession(args: {
  email: string;
  stripePriceId: string;
  successUrl: string;
  cancelUrl: string;
  metadata: CheckoutMetadata;
}): Promise<StripeResult<{ checkoutUrl: string; sessionId: string }>> {
  // Stripe's MetadataParam is a plain string->string record — CheckoutMetadata's
  // optional subscription_id and union-typed kind don't structurally match,
  // so build the wire-format object explicitly rather than casting.
  const metadata: Record<string, string> = {
    kind: args.metadata.kind,
    profile_id: args.metadata.profile_id,
    item_code: args.metadata.item_code,
    ...(args.metadata.subscription_id ? { subscription_id: args.metadata.subscription_id } : {}),
  };

  const result = await stripeCall((stripe) =>
    stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: args.email,
      line_items: [{ price: args.stripePriceId, quantity: 1 }],
      success_url: `${args.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: args.cancelUrl,
      metadata,
      subscription_data: { metadata },
    }),
  );
  if (!result.ok) return result;
  if (!result.data.url) {
    return { ok: false, error: "Stripe did not return a checkout URL" };
  }
  return { ok: true, data: { checkoutUrl: result.data.url, sessionId: result.data.id } };
}

/**
 * Same-request UX confirmation only ("payment received, activating…") for
 * the checkout-callback page — NEVER used to activate a subscription.
 * stripe-webhook's checkout.session.completed handler is the sole source of
 * truth for activation, mirroring verifyTransaction()'s role for Paystack.
 */
export async function verifyCheckoutSession(
  sessionId: string,
): Promise<StripeResult<{ paymentStatus: string; metadata: CheckoutMetadata | null }>> {
  const result = await stripeCall((stripe) => stripe.checkout.sessions.retrieve(sessionId));
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      paymentStatus: result.data.payment_status,
      metadata: (result.data.metadata as unknown as CheckoutMetadata) ?? null,
    },
  };
}

/**
 * Stops future renewals for a Stripe subscription (base-plan or add-on).
 * Mirrors disableSubscription()'s semantics — marks the subscription
 * non-renewing but leaves the current, already-paid-for period to run out.
 * Unlike Paystack, no separate email-token is needed: only `subscriptionId`
 * plus our own STRIPE_SECRET_KEY is required to cancel.
 */
export async function cancelStripeSubscription(
  subscriptionId: string,
): Promise<StripeResult<{ cancelAtPeriodEnd: boolean }>> {
  const result = await stripeCall((stripe) =>
    stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true }),
  );
  if (!result.ok) return result;
  return { ok: true, data: { cancelAtPeriodEnd: result.data.cancel_at_period_end } };
}
