import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { verifyTransactionDetail } from "@/lib/paystack/transactions";
import { writeReconciliationFlag } from "@/lib/finance/reconciliation-flags";

/**
 * Stale-checkout hygiene for service_purchases, plus the one self-heal the
 * payment path was missing.
 *
 * THE GAP THIS CLOSES. A service_purchases row is created 'pending_payment'
 * by record_service_purchase_intent and only ever leaves that state when the
 * Paystack webhook lands. If the webhook never arrives, nothing anywhere
 * looked again: the callback page is display-only (correctly — the webhook is
 * authoritative), runReconciliationSweep is detect-only and daily, and unlike
 * pharmacy_orders there was no 24h expiry pass at all. Rows simply sat there.
 * Four are pending on the live project as of 2026-09-05, three of them older
 * than 24 hours.
 *
 * WHAT IT DOES, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * For each pending_payment row older than the cutoff:
 *
 *   * NO PROVIDER REFERENCE — checkout never got as far as
 *     /transaction/initialize (all four live stranded rows are this shape).
 *     No charge can exist. Cancelled outright, exactly as
 *     pharmacy-order-refunds cancels an abandoned order.
 *
 *   * A REFERENCE PAYSTACK CONFIRMS AS SUCCESSFUL — the patient paid and the
 *     webhook never landed. NOT cancelled, and NOT activated here either:
 *     activation stays the webhook's job, because that is the only path that
 *     writes payment_transactions, drives the ledger triggers and applies the
 *     amount check. The self-heal is to STOP the row being cancelled out from
 *     under a real payment and to raise a payment_reconciliation_flags row so
 *     a human replays it. Cancelling a paid-for purchase would be the
 *     expensive mistake here, and it is the one the naive 24h sweep would
 *     have made.
 *
 *   * A REFERENCE PAYSTACK DOES NOT CONFIRM — abandoned at the hosted
 *     checkout page. Cancelled.
 *
 *   * A REFERENCE AND NO PAYSTACK CREDENTIALS — left alone and counted. An
 *     environment that cannot ask the provider must not guess.
 *
 * Idempotent by construction: it only ever reads rows still in
 * 'pending_payment', so a cancelled row is never revisited, and it flags
 * through the same writeReconciliationFlag() helper runReconciliationSweep
 * uses, which matches an already-open flag rather than duplicating it. It
 * never issues a refund and never touches payment_transactions, so it cannot
 * interact with the refund idempotency key in
 * lib/billing/refund-idempotency.ts.
 */

const STALE_AFTER_MS = 24 * 3600_000;

export interface StalePurchaseRow {
  id: string;
  organisation_id: string | null;
  amount_kobo: number | null;
  payable_kobo: number | null;
  currency: string | null;
  pending_payment_provider_ref: string | null;
}

export type StalePurchaseAction =
  /** No charge can exist. Safe to cancel. */
  | { kind: "cancel"; reason: string }
  /** The provider says this was paid. Leave it, flag it, let a human replay. */
  | { kind: "flag_paid"; reference: string; providerAmountMinor: number | null }
  /** Cannot ask the provider. Do nothing rather than guess. */
  | { kind: "skip"; reason: string };

/**
 * The whole decision, as a pure function, so the "never cancel a purchase the
 * provider says was paid for" rule is testable without a Paystack account.
 * `providerStatus` is null when the provider could not be asked at all, and
 * the string Paystack returned otherwise.
 */
export function decideStalePurchase(
  row: StalePurchaseRow,
  provider: { asked: boolean; status: string | null; amountMinor: number | null },
): StalePurchaseAction {
  const reference = row.pending_payment_provider_ref?.trim();
  if (!reference) {
    return {
      kind: "cancel",
      reason: "Checkout was never started with the payment provider, so no charge can exist.",
    };
  }
  if (!provider.asked) {
    return {
      kind: "skip",
      reason: "The payment provider could not be asked about this reference.",
    };
  }
  if (provider.status === "success") {
    return { kind: "flag_paid", reference, providerAmountMinor: provider.amountMinor };
  }
  return {
    kind: "cancel",
    reason: `The payment provider has no successful charge for this checkout (${provider.status ?? "unknown"}).`,
  };
}

export interface StalePurchaseSweepTotals {
  checked: number;
  cancelled: number;
  paidButUnactivated: number;
  skipped: number;
}

export async function sweepStaleServicePurchases(
  supabase: SupabaseClient<Database>,
  now: Date = new Date(),
): Promise<StalePurchaseSweepTotals> {
  const totals: StalePurchaseSweepTotals = {
    checked: 0,
    cancelled: 0,
    paidButUnactivated: 0,
    skipped: 0,
  };

  const cutoff = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
  const { data: rows } = await supabase
    .from("service_purchases")
    .select("id, organisation_id, amount_kobo, payable_kobo, currency, pending_payment_provider_ref")
    .eq("status", "pending_payment")
    .lt("created_at", cutoff);

  const paystackReady = isPaystackConfigured();

  for (const row of (rows ?? []) as StalePurchaseRow[]) {
    totals.checked += 1;

    let asked = false;
    let status: string | null = null;
    let amountMinor: number | null = null;
    const reference = row.pending_payment_provider_ref?.trim();
    if (reference && paystackReady) {
      const verified = await verifyTransactionDetail(reference);
      if (verified.ok) {
        asked = true;
        status = verified.data.status;
        amountMinor = verified.data.amountMinor;
      }
    }

    const action = decideStalePurchase(row, { asked, status, amountMinor });

    if (action.kind === "skip") {
      totals.skipped += 1;
      continue;
    }

    if (action.kind === "cancel") {
      await supabase
        .from("service_purchases")
        .update({ status: "cancelled", cancelled_at: now.toISOString() })
        .eq("id", row.id)
        // Re-asserted so a webhook that lands between the read and the write
        // wins: the row it activated is no longer pending_payment, and this
        // update matches nothing.
        .eq("status", "pending_payment");
      totals.cancelled += 1;
      continue;
    }

    totals.paidButUnactivated += 1;
    const detail: Json = {
      note:
        "Paystack confirms this checkout was paid, but the purchase never left pending_payment — the webhook did not land. Not cancelled, and not activated here: replay the webhook so the payment record, the amount check and the ledger posting all run.",
      service_purchase_id: row.id,
    };
    await writeReconciliationFlag(supabase, {
      organisation_id: row.organisation_id,
      provider: "paystack",
      flag_type: "status_mismatch",
      provider_reference: action.reference,
      payment_transaction_id: null,
      local_amount_minor: row.payable_kobo ?? row.amount_kobo,
      provider_amount_minor: action.providerAmountMinor,
      local_status: "pending_payment",
      provider_status: "success",
      currency: (row.currency?.toUpperCase() ?? null) as
        | Database["public"]["Enums"]["currency"]
        | null,
      detail,
    });
  }

  return totals;
}
