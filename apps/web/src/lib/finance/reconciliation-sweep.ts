import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { listSuccessfulTransactions } from "@/lib/paystack/transactions";
import {
  writeReconciliationFlags,
  type CurrencyCode,
  type ReconciliationFlag,
} from "@/lib/finance/reconciliation-flags";

export type { CurrencyCode };
const CURRENCY_CODES: readonly CurrencyCode[] = ["NGN", "GBP", "USD"];
export function toCurrencyCode(value: string | null | undefined): CurrencyCode | null {
  const upper = value?.toUpperCase();
  return (CURRENCY_CODES as readonly string[]).includes(upper ?? "") ? (upper as CurrencyCode) : null;
}

/**
 * Automated Paystack reconciliation sweep — detection only, no
 * auto-remediation. Compares what Paystack says actually happened against
 * payment_transactions (the local record built entirely from webhook
 * delivery) and writes a payment_reconciliation_flags row for any mismatch,
 * for a human to review on /finance/reconciliation. See that table's own
 * migration header (20260812023750_payment_reconciliation_ flags.sql) for
 * why this stays detect-and-flag rather than auto-fixing — the
 * financial/compliance stakes of an automated write being wrong here are
 * higher than the cost of a human looking at a flag.
 *
 * Deliberately narrow: it answers "did the provider record something we
 * don't have, or something different from what we have" — it does not
 * re-derive revenue, does not touch the ledger, and does not resolve
 * anything on its own.
 *
 * Paystack only. A Stripe half of this sweep was removed 2026-09-03 along
 * with the rest of the Stripe integration — there was never a registered
 * Stripe account behind it.
 *
 * CORRECTED 2026-09-05: this comment used to claim the only
 * `provider='stripe'` row the platform ever had was test data "deleted in
 * the same migration that dropped Stripe". That is not true.
 * 20260902231042_delete_test_stripe_purchase.sql deleted one
 * SERVICE_PURCHASES row and asserted only that no USD/stripe
 * service_purchases row remained; it never touched payment_transactions, and
 * three `provider='stripe'` payment_transactions rows from 2026-08-15/16 are
 * still live (two subscription lifecycle events and one
 * invoice.payment_succeeded, all with processed_at null, so none of them ever
 * posted to the ledger). They are left in place deliberately — deleting
 * historical payment records is a founder/finance decision, not a cleanup —
 * but nothing here should be read as saying they are gone.
 */

interface SweepTotals {
  paystackChecked: number;
  flagsWritten: number;
  paystackError: string | null;
}

export type LocalTxnRow = {
  id: string;
  organisation_id: string | null;
  amount_minor: number | null;
  currency: string | null;
  processed_at: string | null;
  error: string | null;
  raw_payload: unknown;
};

export function localStatusOf(row: LocalTxnRow): string {
  if (row.error) return `failed: ${row.error}`;
  if (row.processed_at) return "processed";
  return "pending";
}

export async function runReconciliationSweep(supabase: SupabaseClient<Database>): Promise<SweepTotals> {
  // 48h window with overlap: a run that fails or lands mid-day costs a
  // repeated check next time, never a gap — same overlap-over-gap choice
  // apps/web/src/lib/wearables/sync.ts's pullConnection makes for its own
  // cursor.
  const now = new Date();
  const windowStart = new Date(now.getTime() - 48 * 3600_000);

  const totals: SweepTotals = {
    paystackChecked: 0,
    flagsWritten: 0,
    paystackError: null,
  };

  if (!isPaystackConfigured()) {
    return totals;
  }

  const result = await listSuccessfulTransactions({
    from: windowStart.toISOString(),
    to: now.toISOString(),
  });
  if (!result.ok) {
    totals.paystackError = result.error;
    return totals;
  }

  totals.paystackChecked = result.data.length;
  const references = result.data.map((t) => t.reference);
  const { data: localRows } = references.length
    ? await supabase
        .from("payment_transactions")
        .select("id, organisation_id, amount_minor, currency, processed_at, error, provider_event_id")
        .eq("provider", "paystack")
        .in("provider_event_id", references)
    : { data: [] as (LocalTxnRow & { provider_event_id: string })[] };
  const byRef = new Map((localRows ?? []).map((r) => [r.provider_event_id, r as LocalTxnRow]));

  const flags: ReconciliationFlag[] = [];
  for (const txn of result.data) {
    const local = byRef.get(txn.reference);
    if (!local) {
      flags.push({
        organisation_id: null,
        provider: "paystack",
        flag_type: "missing_locally",
        provider_reference: txn.reference,
        payment_transaction_id: null,
        local_amount_minor: null,
        provider_amount_minor: txn.amount,
        local_status: null,
        provider_status: txn.status,
        currency: toCurrencyCode(txn.currency),
        detail: { note: "Paystack recorded a successful charge with no matching payment_transactions row — the webhook may never have fired." },
      });
      continue;
    }
    const status = localStatusOf(local);
    if (status !== "processed") {
      flags.push({
        organisation_id: local.organisation_id,
        provider: "paystack",
        flag_type: "status_mismatch",
        provider_reference: txn.reference,
        payment_transaction_id: local.id,
        local_amount_minor: local.amount_minor,
        provider_amount_minor: txn.amount,
        local_status: status,
        provider_status: txn.status,
        currency: toCurrencyCode(txn.currency),
        detail: { note: "Paystack says success, but the local webhook row never reached processed_at." },
      });
    } else if (local.amount_minor != null && local.amount_minor !== txn.amount) {
      flags.push({
        organisation_id: local.organisation_id,
        provider: "paystack",
        flag_type: "amount_mismatch",
        provider_reference: txn.reference,
        payment_transaction_id: local.id,
        local_amount_minor: local.amount_minor,
        provider_amount_minor: txn.amount,
        local_status: status,
        provider_status: txn.status,
        currency: toCurrencyCode(txn.currency),
        detail: { note: "Amount recorded locally does not match Paystack's own record of the charge." },
      });
    }
  }
  totals.flagsWritten += await writeReconciliationFlags(supabase, flags);

  return totals;
}
