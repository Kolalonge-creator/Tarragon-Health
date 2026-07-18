import { paystackFetch, type PaystackResult } from "./client";
import type { CheckoutMetadata } from "@/lib/billing/checkout-metadata";
export type { CheckoutKind, CheckoutMetadata } from "@/lib/billing/checkout-metadata";

interface InitializeTransactionData {
  authorization_url: string;
  access_code: string;
  reference: string;
}

/**
 * Starts a hosted-checkout redirect flow: the browser is sent to
 * `authorization_url`, Paystack collects card details on its own page (none
 * of it ever touches our servers), and Paystack redirects back to
 * `callbackUrl` when done. Passing `plan` makes this the *first* charge of a
 * Paystack-native recurring subscription — Paystack authorizes the card and
 * drives all future renewals itself via webhooks, no cron needed here.
 */
export async function initializeTransaction(args: {
  email: string;
  amountMinor: number;
  currency: "NGN" | "GBP" | "USD";
  paystackPlanCode: string;
  callbackUrl: string;
  metadata: CheckoutMetadata;
}): Promise<PaystackResult<{ authorizationUrl: string; reference: string }>> {
  const result = await paystackFetch<InitializeTransactionData>("/transaction/initialize", {
    method: "POST",
    body: {
      email: args.email,
      amount: args.amountMinor,
      currency: args.currency,
      plan: args.paystackPlanCode,
      callback_url: args.callbackUrl,
      metadata: args.metadata,
    },
  });
  if (!result.ok) return result;
  return {
    ok: true,
    data: { authorizationUrl: result.data.authorization_url, reference: result.data.reference },
  };
}

/**
 * Same hosted-checkout redirect as initializeTransaction(), but omits
 * `plan` entirely — Paystack treats a transaction with no plan code as a
 * single, non-recurring charge: it authorizes and captures the card once,
 * fires `charge.success`, and never creates a subscription or expects a
 * renewal. Used for one-off booking payments (lab/pharmacy/specialist
 * referral), never for anything that should auto-renew.
 */
export async function initializeOneOffTransaction(args: {
  email: string;
  amountMinor: number;
  currency: "NGN" | "GBP" | "USD";
  callbackUrl: string;
  metadata: CheckoutMetadata;
}): Promise<PaystackResult<{ authorizationUrl: string; reference: string }>> {
  const result = await paystackFetch<InitializeTransactionData>("/transaction/initialize", {
    method: "POST",
    body: {
      email: args.email,
      amount: args.amountMinor,
      currency: args.currency,
      callback_url: args.callbackUrl,
      metadata: args.metadata,
    },
  });
  if (!result.ok) return result;
  return {
    ok: true,
    data: { authorizationUrl: result.data.authorization_url, reference: result.data.reference },
  };
}

interface VerifyTransactionData {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  metadata: CheckoutMetadata | null;
}

/**
 * Same-request UX confirmation only ("payment received, activating…") for
 * the checkout-callback page — NEVER used to activate a subscription. The
 * paystack-webhook Edge Function is the sole source of truth for
 * activation, so a patient can't spoof success by hitting the callback URL
 * directly with a fabricated reference.
 */
export async function verifyTransaction(
  reference: string,
): Promise<PaystackResult<{ status: string; metadata: CheckoutMetadata | null }>> {
  const result = await paystackFetch<VerifyTransactionData>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
  );
  if (!result.ok) return result;
  return { ok: true, data: { status: result.data.status, metadata: result.data.metadata } };
}

interface DisableSubscriptionData {
  status: string;
}

/**
 * Stops future renewals for a Paystack-native subscription (used for both
 * base-plan and add-on cancellation). Paystack's own semantics: the
 * subscription is marked non-renewing but the current, already-paid-for
 * period is left to run out — it does not immediately revoke access, which
 * is why `subscriptions.status` stays 'active' until the matching
 * `subscription.disable` webhook lands at the real period end.
 */
export async function disableSubscription(args: {
  subscriptionCode: string;
  emailToken: string;
}): Promise<PaystackResult<{ status: string }>> {
  const result = await paystackFetch<DisableSubscriptionData>("/subscription/disable", {
    method: "POST",
    body: { code: args.subscriptionCode, token: args.emailToken },
  });
  if (!result.ok) return result;
  return { ok: true, data: { status: result.data.status } };
}
