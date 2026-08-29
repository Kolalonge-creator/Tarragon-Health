import { paystackFetch, type PaystackResult } from "./client";
import type { CheckoutMetadata } from "@/lib/billing/checkout-metadata";
export type { CheckoutKind, CheckoutMetadata } from "@/lib/billing/checkout-metadata";

export interface PaystackTransactionSummary {
  reference: string;
  amount: number;
  currency: string;
  status: string;
}

/**
 * Lists successful Paystack transactions in a time window — used only by the
 * reconciliation sweep (apps/web/src/lib/finance/reconciliation-sweep.ts),
 * never the checkout/webhook path. `reference` here is the same value
 * stripe-webhook's Paystack counterpart stores as `payment_transactions.
 * provider_event_id` for a charge.success event (see that function's own
 * fallback-chain comment) — that's what lets the sweep match a provider
 * transaction back to a local row.
 *
 * Paginates by requesting pages until one comes back shorter than perPage.
 * Paystack's list envelope carries a total in `meta`, not `data`, and
 * paystackFetch() only ever surfaces `data` — checking length against
 * perPage avoids threading `meta` through the shared client for this one
 * caller. Capped at 50 pages (5,000 transactions) as a safety bound against
 * a runaway loop; a 48h reconciliation window at current volume is nowhere
 * near that.
 */
export async function listSuccessfulTransactions(args: {
  from: string; // ISO8601
  to: string; // ISO8601
}): Promise<PaystackResult<PaystackTransactionSummary[]>> {
  const perPage = 100;
  const all: PaystackTransactionSummary[] = [];
  for (let page = 1; page <= 50; page++) {
    const result = await paystackFetch<PaystackTransactionSummary[]>(
      `/transaction?status=success&perPage=${perPage}&page=${page}` +
        `&from=${encodeURIComponent(args.from)}&to=${encodeURIComponent(args.to)}`,
    );
    if (!result.ok) return result;
    all.push(...result.data);
    if (result.data.length < perPage) break;
  }
  return { ok: true, data: all };
}

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

interface BankTransferChargeData {
  reference: string;
  status: string;
  bank_transfer?: {
    bank?: { name?: string } | null;
    account_number?: string;
    account_expires_at?: string;
  } | null;
}

/**
 * Pay with Transfer: requests a temporary, single-transaction NGN account
 * number from Paystack's generic /charge endpoint (bank_transfer channel)
 * — not a Dedicated Virtual Account, so no customer BVN/Customer
 * Identification is involved (see docs/PAYSTACK_PAY_WITH_TRANSFER_SPEC.md
 * §1 for why the two must not be confused). The account details come back
 * directly in this response, unlike initializeOneOffTransaction()'s
 * authorization_url — no webhook wait is needed to show them to the
 * patient. paystack-webhook's existing charge.success handling (keyed on
 * `reference`, channel-agnostic) is what actually confirms the payment;
 * this function only starts the charge.
 *
 * Flagged for the real test-mode round trip: the exact response shape for
 * bank_transfer is asserted defensively below rather than trusted, since
 * this has never been exercised against live Paystack.
 */
export async function initializeBankTransferCharge(args: {
  email: string;
  amountMinor: number; // NGN only — Transfer is a Nigerian-rails-only channel
  expiresInMinutes: number; // Paystack clamps to 15–480; stay inside that range
  metadata: CheckoutMetadata;
}): Promise<
  PaystackResult<{ reference: string; bankName: string; accountNumber: string; expiresAt: string }>
> {
  const accountExpiresAt = new Date(Date.now() + args.expiresInMinutes * 60_000).toISOString();
  const result = await paystackFetch<BankTransferChargeData>("/charge", {
    method: "POST",
    body: {
      email: args.email,
      amount: args.amountMinor,
      currency: "NGN",
      bank_transfer: { account_expires_at: accountExpiresAt },
      metadata: args.metadata,
    },
  });
  if (!result.ok) return result;

  const bankName = result.data.bank_transfer?.bank?.name;
  const accountNumber = result.data.bank_transfer?.account_number;
  if (!bankName || !accountNumber) {
    return {
      ok: false,
      error:
        "Paystack did not return transfer account details — Pay with Transfer may not be enabled on this account yet.",
    };
  }

  return {
    ok: true,
    data: {
      reference: result.data.reference,
      bankName,
      accountNumber,
      expiresAt: result.data.bank_transfer?.account_expires_at ?? accountExpiresAt,
    },
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

/**
 * Turns auto-renewal back on for a previously-disabled Paystack subscription
 * — the inverse of disableSubscription(). Used when a patient changes their
 * mind before the current period ends and wants to keep being billed. Same
 * (code, token) pair; Paystack re-enables recurring charges from the next
 * billing date.
 */
export async function enableSubscription(args: {
  subscriptionCode: string;
  emailToken: string;
}): Promise<PaystackResult<{ status: string }>> {
  const result = await paystackFetch<DisableSubscriptionData>("/subscription/enable", {
    method: "POST",
    body: { code: args.subscriptionCode, token: args.emailToken },
  });
  if (!result.ok) return result;
  return { ok: true, data: { status: result.data.status } };
}
