import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";

type CurrencyCode = Database["public"]["Enums"]["currency"];
function toCurrencyCode(value: string | null | undefined): CurrencyCode | null {
  return value === "NGN" || value === "GBP" || value === "USD" ? value : null;
}

/**
 * §91.17 fraud detection. `payment_fraud_signals` and its two read/resolve
 * RPCs already existed live before this sweep was written (a concurrent
 * session built the schema — see the recovered
 * 20260829001612_payment_fraud_signals.sql migration) but nothing ever
 * wrote a signal into it. This is that missing detection engine, mirroring
 * reconciliation-sweep.ts's shape: pure functions over fetched rows, an
 * idempotent write keyed by a dedupe_key (the table's own partial unique
 * index on dedupe_key WHERE status='open' makes a re-run a no-op for an
 * already-open signal), detection only — no automated account action.
 *
 * Payer resolution reuses private.resolve_payment_payer via the
 * service-role-only payments_with_payer_for_fraud_sweep RPC rather than
 * duplicating that join logic here.
 */

export type SweepPayment = {
  id: string;
  payer_profile_id: string | null;
  organisation_id: string | null;
  amount_minor: number | null;
  currency: string | null;
  provider: string | null;
  event_type: string | null;
  processed_at: string | null;
  error: string | null;
  created_at: string;
};

export interface FraudSignalWrite {
  organisation_id: string | null;
  patient_id: string | null;
  signal_type: "duplicate_transaction" | "rapid_velocity" | "refund_concentration" | "unusual_amount" | "chargeback";
  severity: "low" | "medium" | "high";
  dedupe_key: string;
  payment_transaction_id: string | null;
  amount_minor: number | null;
  currency: CurrencyCode | null;
  detail: Json;
}

const MONEY_IN_EVENTS = new Set(["charge.success", "checkout.session.completed", "invoice.payment_succeeded"]);

function isSuccessful(p: SweepPayment): boolean {
  return Boolean(p.processed_at) && !p.error && MONEY_IN_EVENTS.has(p.event_type ?? "");
}

/** Two or more successful charges for the same payer, same amount, same
 * currency, within a short window — the classic accidental-double-charge or
 * card-testing shape. Only ever flags the second (and later) occurrence
 * against the first, never the first against itself. */
export function detectDuplicateTransactions(payments: SweepPayment[], windowMs = 30 * 60_000): FraudSignalWrite[] {
  const successful = payments
    .filter((p) => isSuccessful(p) && p.payer_profile_id && p.amount_minor != null)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const signals: FraudSignalWrite[] = [];
  for (let i = 0; i < successful.length; i++) {
    for (let j = i + 1; j < successful.length; j++) {
      const a = successful[i];
      const b = successful[j];
      const gap = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (gap > windowMs) break; // sorted by time — nothing further out can be within the window either
      if (a.payer_profile_id !== b.payer_profile_id) continue;
      if (a.amount_minor !== b.amount_minor) continue;
      if (a.currency !== b.currency) continue;
      const key = [a.id, b.id].sort().join(":");
      signals.push({
        organisation_id: b.organisation_id,
        patient_id: b.payer_profile_id,
        signal_type: "duplicate_transaction",
        severity: "medium",
        dedupe_key: `duplicate_transaction:${key}`,
        payment_transaction_id: b.id,
        amount_minor: b.amount_minor,
        currency: toCurrencyCode(b.currency),
        detail: {
          other_payment_transaction_id: a.id,
          minutes_apart: Math.round(gap / 60_000),
          note: "Two successful charges for the same amount, same payer, within 30 minutes.",
        },
      });
    }
  }
  return signals;
}

/** A payer with an unusually high number of payment attempts (successful or
 * failed) in a short window — card testing or a struggling automated retry
 * loop both look like this. Bucketed to one signal per payer per window
 * rather than one per attempt, so the dedupe_key naturally collapses a
 * whole burst into a single open signal. */
export function detectRapidVelocity(
  payments: SweepPayment[],
  windowMs = 3600_000,
  threshold = 5,
): FraudSignalWrite[] {
  const byPayer = new Map<string, SweepPayment[]>();
  for (const p of payments) {
    if (!p.payer_profile_id) continue;
    if (!MONEY_IN_EVENTS.has(p.event_type ?? "") && !p.error) continue;
    const list = byPayer.get(p.payer_profile_id) ?? [];
    list.push(p);
    byPayer.set(p.payer_profile_id, list);
  }

  const signals: FraudSignalWrite[] = [];
  for (const [payerId, attempts] of byPayer) {
    const sorted = [...attempts].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    for (let i = 0; i + threshold - 1 < sorted.length; i++) {
      const windowAttempts = sorted.slice(i, i + threshold);
      const span =
        new Date(windowAttempts[windowAttempts.length - 1].created_at).getTime() -
        new Date(windowAttempts[0].created_at).getTime();
      if (span > windowMs) continue;
      const bucket = windowAttempts[0].created_at.slice(0, 13); // hour bucket, collapses overlapping windows
      signals.push({
        organisation_id: windowAttempts[0].organisation_id,
        patient_id: payerId,
        signal_type: "rapid_velocity",
        severity: "high",
        dedupe_key: `rapid_velocity:${payerId}:${bucket}`,
        payment_transaction_id: windowAttempts[windowAttempts.length - 1].id,
        amount_minor: null,
        currency: null,
        detail: {
          attempt_count: windowAttempts.length,
          minutes_span: Math.round(span / 60_000),
          note: `${windowAttempts.length} payment attempts within roughly an hour.`,
        },
      });
      break; // one signal per payer per sweep run is enough — don't re-flag every overlapping window
    }
  }
  return signals;
}

/** A payer whose current charge is far larger than their own recent
 * average — needs at least a few prior successful charges to establish a
 * baseline, so this only fires for an established payer suddenly spiking,
 * not a patient's very first payment. */
export function detectUnusualAmounts(payments: SweepPayment[], multiple = 5, minHistory = 3): FraudSignalWrite[] {
  const byPayer = new Map<string, SweepPayment[]>();
  for (const p of payments) {
    if (!isSuccessful(p) || !p.payer_profile_id || p.amount_minor == null) continue;
    const list = byPayer.get(p.payer_profile_id) ?? [];
    list.push(p);
    byPayer.set(p.payer_profile_id, list);
  }

  const signals: FraudSignalWrite[] = [];
  for (const [payerId, list] of byPayer) {
    if (list.length < minHistory + 1) continue;
    const sorted = [...list].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const latest = sorted[sorted.length - 1];
    const history = sorted.slice(0, -1);
    const avg = history.reduce((sum, p) => sum + (p.amount_minor ?? 0), 0) / history.length;
    if (avg <= 0) continue;
    if ((latest.amount_minor ?? 0) < avg * multiple) continue;
    signals.push({
      organisation_id: latest.organisation_id,
      patient_id: payerId,
      signal_type: "unusual_amount",
      severity: "low",
      dedupe_key: `unusual_amount:${latest.id}`,
      payment_transaction_id: latest.id,
      amount_minor: latest.amount_minor,
      currency: toCurrencyCode(latest.currency),
      detail: {
        historical_average_minor: Math.round(avg),
        history_count: history.length,
        note: `Charge is ${Math.round((latest.amount_minor ?? 0) / avg)}x this payer's recent average.`,
      },
    });
  }
  return signals;
}

export type SweepRefund = {
  id: string;
  amount_minor: number;
  currency: string;
  created_at: string;
  voucher: { beneficiary_profile_id: string; organisation_id: string } | null;
};

/** A patient with an unusually high number of completed refunds in a
 * rolling window — a real pattern worth a human look (repeated buyer's
 * remorse, or someone probing how easily a refund is granted), distinct
 * from the payment-side signals above since it reads voucher_refund_queue,
 * not payment_transactions. */
export function detectRefundConcentration(refunds: SweepRefund[], windowDays = 30, threshold = 3): FraudSignalWrite[] {
  const byPatient = new Map<string, SweepRefund[]>();
  for (const r of refunds) {
    if (!r.voucher) continue;
    const list = byPatient.get(r.voucher.beneficiary_profile_id) ?? [];
    list.push(r);
    byPatient.set(r.voucher.beneficiary_profile_id, list);
  }

  const signals: FraudSignalWrite[] = [];
  for (const [patientId, list] of byPatient) {
    if (list.length < threshold) continue;
    const sorted = [...list].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const span = new Date(sorted[sorted.length - 1].created_at).getTime() - new Date(sorted[0].created_at).getTime();
    if (span > windowDays * 86_400_000) continue;
    const monthBucket = sorted[sorted.length - 1].created_at.slice(0, 7);
    signals.push({
      organisation_id: sorted[0].voucher?.organisation_id ?? null,
      patient_id: patientId,
      signal_type: "refund_concentration",
      severity: "medium",
      dedupe_key: `refund_concentration:${patientId}:${monthBucket}`,
      payment_transaction_id: null,
      amount_minor: sorted.reduce((sum, r) => sum + r.amount_minor, 0),
      currency: toCurrencyCode(sorted[0].currency),
      detail: {
        refund_count: sorted.length,
        window_days: windowDays,
        note: `${sorted.length} completed refunds within roughly ${windowDays} days.`,
      },
    });
  }
  return signals;
}

async function writeSignals(supabase: SupabaseClient<Database>, signals: FraudSignalWrite[]): Promise<number> {
  if (signals.length === 0) return 0;
  const { error } = await supabase
    .from("payment_fraud_signals")
    .upsert(signals, { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (error) {
    console.error("fraud-sweep: failed to write signals", error);
    return 0;
  }
  return signals.length;
}

export interface FraudSweepTotals {
  paymentsChecked: number;
  signalsWritten: number;
}

export async function runFraudSweep(supabase: SupabaseClient<Database>): Promise<FraudSweepTotals> {
  const now = new Date();
  const paymentsWindowStart = new Date(now.getTime() - 24 * 3600_000);
  const refundsWindowStart = new Date(now.getTime() - 30 * 86_400_000);

  const [{ data: payments }, { data: refunds }] = await Promise.all([
    supabase.rpc("payments_with_payer_for_fraud_sweep", {
      p_from: paymentsWindowStart.toISOString(),
      p_to: now.toISOString(),
    }),
    supabase
      .from("voucher_refund_queue")
      .select("id, amount_minor, currency, created_at, voucher:care_vouchers(beneficiary_profile_id, organisation_id)")
      .eq("status", "refunded")
      .gte("created_at", refundsWindowStart.toISOString()),
  ]);

  const paymentRows = (payments ?? []) as SweepPayment[];
  const refundRows = (refunds ?? []) as unknown as SweepRefund[];

  const signals = [
    ...detectDuplicateTransactions(paymentRows),
    ...detectRapidVelocity(paymentRows),
    ...detectUnusualAmounts(paymentRows),
    ...detectRefundConcentration(refundRows),
  ];

  const written = await writeSignals(supabase, signals);
  return { paymentsChecked: paymentRows.length, signalsWritten: written };
}
