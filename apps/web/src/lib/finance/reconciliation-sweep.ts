import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { listSuccessfulTransactions } from "@/lib/paystack/transactions";
import { listReconciliationEvents } from "@/lib/stripe/reconciliation";

export type CurrencyCode = Database["public"]["Enums"]["currency"];
const CURRENCY_CODES: readonly CurrencyCode[] = ["NGN", "GBP", "USD"];
export function toCurrencyCode(value: string | null | undefined): CurrencyCode | null {
  const upper = value?.toUpperCase();
  return (CURRENCY_CODES as readonly string[]).includes(upper ?? "") ? (upper as CurrencyCode) : null;
}

/**
 * Automated Paystack/Stripe reconciliation sweep — detection only, no
 * auto-remediation. Compares what each provider says actually happened
 * against payment_transactions (the local record built entirely from
 * webhook delivery) and writes a payment_reconciliation_flags row for any
 * mismatch, for a human to review on /finance/reconciliation. See that
 * table's own migration header (20260812023750_payment_reconciliation_
 * flags.sql) for why this stays detect-and-flag rather than auto-fixing —
 * the financial/compliance stakes of an automated write being wrong here
 * are higher than the cost of a human looking at a flag.
 *
 * Deliberately narrow: it answers "did the provider record something we
 * don't have, or something different from what we have" — it does not
 * re-derive revenue, does not touch the ledger, and does not resolve
 * anything on its own.
 */

interface SweepTotals {
  paystackChecked: number;
  stripeChecked: number;
  flagsWritten: number;
  paystackError: string | null;
  stripeError: string | null;
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

/** supabase/functions/stripe-webhook/index.ts populates amount_minor/
 * currency at insert as of 2026-08-12 (fixed same day this sweep's own dry
 * run found every historical Stripe row had both null) — but any row
 * written before that fix still has nulls forever, since this is a webhook
 * insert, not a backfillable column. Recovering from the row's own stored
 * raw_payload keeps the sweep correct for those pre-fix rows without a
 * migration; for anything written after the fix this is just a slower path
 * to the same value already in amount_minor. */
export function localStripeAmount(row: LocalTxnRow): { amountMinor: number | null; currency: string | null } {
  if (row.amount_minor != null) return { amountMinor: row.amount_minor, currency: row.currency };
  const payload = row.raw_payload as { data?: { object?: Record<string, unknown> }; type?: string } | null;
  const obj = payload?.data?.object;
  if (!obj) return { amountMinor: null, currency: null };
  const currency = typeof obj.currency === "string" ? obj.currency.toUpperCase() : null;
  if (payload?.type === "checkout.session.completed" && typeof obj.amount_total === "number") {
    return { amountMinor: obj.amount_total, currency };
  }
  if (payload?.type === "invoice.payment_succeeded" && typeof obj.amount_paid === "number") {
    return { amountMinor: obj.amount_paid, currency };
  }
  return { amountMinor: null, currency };
}

interface FlagWrite {
  organisation_id: string | null;
  provider: "paystack" | "stripe";
  flag_type: "missing_locally" | "amount_mismatch" | "status_mismatch";
  provider_reference: string;
  payment_transaction_id: string | null;
  local_amount_minor: number | null;
  provider_amount_minor: number | null;
  local_status: string | null;
  provider_status: string | null;
  currency: CurrencyCode | null;
  detail: Json;
}

async function writeFlags(supabase: SupabaseClient<Database>, flags: FlagWrite[]): Promise<number> {
  if (flags.length === 0) return 0;
  const { error } = await supabase
    .from("payment_reconciliation_flags")
    .upsert(flags, { onConflict: "provider,provider_reference,flag_type", ignoreDuplicates: false });
  if (error) {
    console.error("reconciliation-sweep: failed to write flags", error);
    return 0;
  }
  return flags.length;
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
    stripeChecked: 0,
    flagsWritten: 0,
    paystackError: null,
    stripeError: null,
  };

  if (isPaystackConfigured()) {
    const result = await listSuccessfulTransactions({
      from: windowStart.toISOString(),
      to: now.toISOString(),
    });
    if (!result.ok) {
      totals.paystackError = result.error;
    } else {
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

      const flags: FlagWrite[] = [];
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
      totals.flagsWritten += await writeFlags(supabase, flags);
    }
  }

  if (process.env.STRIPE_SECRET_KEY) {
    const result = await listReconciliationEvents({
      gteUnixSeconds: Math.floor(windowStart.getTime() / 1000),
      lteUnixSeconds: Math.floor(now.getTime() / 1000),
    });
    if (!result.ok) {
      totals.stripeError = result.error;
    } else {
      totals.stripeChecked = result.data.length;
      const eventIds = result.data.map((e) => e.id);
      const { data: localRows } = eventIds.length
        ? await supabase
            .from("payment_transactions")
            .select("id, organisation_id, amount_minor, currency, processed_at, error, raw_payload, provider_event_id")
            .eq("provider", "stripe")
            .in("provider_event_id", eventIds)
        : { data: [] as (LocalTxnRow & { provider_event_id: string })[] };
      const byId = new Map((localRows ?? []).map((r) => [r.provider_event_id, r as LocalTxnRow]));

      const flags: FlagWrite[] = [];
      for (const evt of result.data) {
        const local = byId.get(evt.id);
        if (!local) {
          flags.push({
            organisation_id: null,
            provider: "stripe",
            flag_type: "missing_locally",
            provider_reference: evt.id,
            payment_transaction_id: null,
            local_amount_minor: null,
            provider_amount_minor: evt.amountMinor,
            local_status: null,
            provider_status: evt.status,
            currency: toCurrencyCode(evt.currency),
            detail: { note: "Stripe recorded this event with no matching payment_transactions row — the webhook may never have fired.", event_type: evt.type },
          });
          continue;
        }
        const status = localStatusOf(local);
        const { amountMinor: localAmount } = localStripeAmount(local);
        if (status !== "processed") {
          flags.push({
            organisation_id: local.organisation_id,
            provider: "stripe",
            flag_type: "status_mismatch",
            provider_reference: evt.id,
            payment_transaction_id: local.id,
            local_amount_minor: localAmount,
            provider_amount_minor: evt.amountMinor,
            local_status: status,
            provider_status: evt.status,
            currency: toCurrencyCode(evt.currency),
            detail: { note: "Stripe recorded this event, but the local webhook row never reached processed_at.", event_type: evt.type },
          });
        } else if (localAmount != null && evt.amountMinor != null && localAmount !== evt.amountMinor) {
          flags.push({
            organisation_id: local.organisation_id,
            provider: "stripe",
            flag_type: "amount_mismatch",
            provider_reference: evt.id,
            payment_transaction_id: local.id,
            local_amount_minor: localAmount,
            provider_amount_minor: evt.amountMinor,
            local_status: status,
            provider_status: evt.status,
            currency: toCurrencyCode(evt.currency),
            detail: { note: "Amount recovered from the stored event does not match Stripe's own record.", event_type: evt.type },
          });
        }
      }
      totals.flagsWritten += await writeFlags(supabase, flags);
    }
  }

  return totals;
}
