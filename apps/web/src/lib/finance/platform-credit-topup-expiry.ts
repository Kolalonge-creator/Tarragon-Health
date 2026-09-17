import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { verifyTransactionDetail } from "@/lib/paystack/transactions";
import { writeReconciliationFlag } from "@/lib/finance/reconciliation-flags";

/**
 * Stale-checkout hygiene for platform_credit_topup_intents — the same gap
 * service-purchase-expiry.ts closed for service_purchases, found while
 * auditing the rest of the Platform Credit feature for what
 * fix/platform-credit-gaps had not yet covered.
 *
 * public.record_platform_credit_topup_intent creates a row
 * 'pending_payment' and it only ever leaves that state when the Paystack
 * webhook fires private.apply_platform_credit_topup_payment. Unlike
 * service_purchases (fixed 2026-09-05) and pharmacy_orders (had this from
 * the start), nothing swept an abandoned top-up: cancel_platform_credit_
 * topup_intent exists but is patient-initiated only, and this feature has
 * no cron of its own. A top-up a patient started and then abandoned (closed
 * the tab, changed their mind, or hit the QA-fixture-email Paystack
 * rejection this same PR fixed the error message for) would sit
 * 'pending_payment' forever.
 *
 * Same decision shape as decideStalePurchase, for the same reason: never
 * cancel an intent the provider says was actually paid for. If that
 * happened, the balance is credited by replaying the webhook (private.
 * apply_platform_credit_topup_payment), never by this sweep — it only
 * flags for a human, exactly like the service_purchases sweep.
 */

const STALE_AFTER_MS = 24 * 3600_000;

export interface StaleTopupRow {
  id: string;
  organisation_id: string | null;
  amount_kobo: number;
  currency: string | null;
  pending_payment_provider_ref: string | null;
}

export type StaleTopupAction =
  /** No charge can exist. Safe to cancel. */
  | { kind: "cancel"; reason: string }
  /** The provider says this was paid. Leave it, flag it, let a human replay the webhook. */
  | { kind: "flag_paid"; reference: string; providerAmountMinor: number | null }
  /** Cannot ask the provider. Do nothing rather than guess. */
  | { kind: "skip"; reason: string };

/**
 * The whole decision, as a pure function — byte-identical shape to
 * decideStalePurchase so the "never cancel something the provider says was
 * paid for" rule is testable the same way, without a Paystack account.
 */
export function decideStaleTopup(
  row: StaleTopupRow,
  provider: { asked: boolean; status: string | null; amountMinor: number | null },
): StaleTopupAction {
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

export interface StaleTopupSweepTotals {
  checked: number;
  cancelled: number;
  paidButUnapplied: number;
  skipped: number;
}

export async function sweepStalePlatformCreditTopups(
  supabase: SupabaseClient<Database>,
  now: Date = new Date(),
): Promise<StaleTopupSweepTotals> {
  const totals: StaleTopupSweepTotals = {
    checked: 0,
    cancelled: 0,
    paidButUnapplied: 0,
    skipped: 0,
  };

  const cutoff = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
  const { data: rows } = await supabase
    .from("platform_credit_topup_intents")
    .select("id, organisation_id, amount_kobo, currency, pending_payment_provider_ref")
    .eq("status", "pending_payment")
    .lt("created_at", cutoff);

  const paystackReady = isPaystackConfigured();

  for (const row of (rows ?? []) as StaleTopupRow[]) {
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

    const action = decideStaleTopup(row, { asked, status, amountMinor });

    if (action.kind === "skip") {
      totals.skipped += 1;
      continue;
    }

    if (action.kind === "cancel") {
      await supabase
        .from("platform_credit_topup_intents")
        .update({ status: "cancelled", cancelled_at: now.toISOString() })
        .eq("id", row.id)
        // Re-asserted so a webhook that lands between the read and the write
        // wins: an intent it just completed is no longer pending_payment,
        // and this update matches nothing.
        .eq("status", "pending_payment");
      totals.cancelled += 1;
      continue;
    }

    totals.paidButUnapplied += 1;
    const detail: Json = {
      note:
        "Paystack confirms this top-up was paid, but the intent never left pending_payment — the webhook did not land. Not cancelled, and the balance not credited here: replay the webhook so private.apply_platform_credit_topup_payment runs and posts the ledger/GL entries.",
      topup_intent_id: row.id,
    };
    await writeReconciliationFlag(supabase, {
      organisation_id: row.organisation_id,
      provider: "paystack",
      flag_type: "status_mismatch",
      provider_reference: action.reference,
      payment_transaction_id: null,
      local_amount_minor: row.amount_kobo,
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
