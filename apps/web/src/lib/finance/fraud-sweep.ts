import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";

type PaymentTransactionType = Database["public"]["Enums"]["payment_transaction_type"];

/**
 * Financial fraud controls, phase 1 (spec §25.24) — see
 * 20260829001257_payment_fraud_signals.sql for why this runs in TypeScript
 * rather than as a SQL RPC: the four heuristics below correlate across
 * payment_transactions, subscriptions, video_visit_requests, lab/pharmacy/
 * referral bookings, lab_order_refunds and care_voucher_payments — sources
 * with no single shared key. Detection only, same posture as
 * reconciliation-sweep.ts: nothing here blocks a payment, reverses a charge,
 * or touches the ledger — it writes a payment_fraud_signals row for a human
 * to review on /finance/fraud.
 */

type Currency = "NGN" | "GBP" | "USD";

export interface NormalizedEvent {
  id: string;
  source: "payment_transactions" | "video_visit_request" | "care_voucher_payment";
  organisationId: string | null;
  patientId: string | null;
  /** Identity a genuine double-charge would share — subscription, booking, or voucher. Null when nothing links this event to a business object. */
  groupKey: string | null;
  amountMinor: number;
  currency: Currency;
  occurredAt: string;
  paymentTransactionId: string | null;
}

export interface FraudSweepTotals {
  eventsScanned: number;
  signalsWritten: number;
}

const VELOCITY_WINDOW_MS = 60 * 60_000; // 1 hour
const VELOCITY_THRESHOLD = 5;
const DUPLICATE_WINDOW_MS = 30 * 60_000; // 30 minutes
const REFUND_CONCENTRATION_THRESHOLD = 3;
const UNUSUAL_AMOUNT_MULTIPLE = 3;
const UNUSUAL_AMOUNT_FLOOR_MINOR = 1_000_000; // NGN 10,000 (or currency-equivalent minor units)

const SUCCESS_EVENT_TYPES: PaymentTransactionType[] = [
  "charge.success",
  "invoice.payment_succeeded",
  "checkout.session.completed",
];

export function isoWeekBucket(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${weekNo}`;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export interface SignalWrite {
  organisation_id: string | null;
  patient_id: string | null;
  signal_type: "duplicate_transaction" | "rapid_velocity" | "refund_concentration" | "unusual_amount";
  severity: "low" | "medium" | "high";
  dedupe_key: string;
  payment_transaction_id: string | null;
  amount_minor: number | null;
  currency: Currency | null;
  detail: Json;
}

async function writeSignals(supabase: SupabaseClient<Database>, signals: SignalWrite[]): Promise<number> {
  if (signals.length === 0) return 0;
  const { error } = await supabase
    .from("payment_fraud_signals")
    .upsert(signals, { onConflict: "dedupe_key", ignoreDuplicates: false });
  if (error) {
    console.error("fraud-sweep: failed to write signals", error);
    return 0;
  }
  return signals.length;
}

async function fetchNormalizedEvents(
  supabase: SupabaseClient<Database>,
  sinceIso: string,
): Promise<NormalizedEvent[]> {
  const events: NormalizedEvent[] = [];

  // ---- payment_transactions (membership + lab/pharmacy/referral bookings) --
  const { data: txns } = await supabase
    .from("payment_transactions")
    .select(
      "id, organisation_id, subscription_id, booking_order_type, booking_order_id, amount_minor, currency, processed_at, created_at, event_type, subscriptions(subscriber_id)",
    )
    .in("event_type", SUCCESS_EVENT_TYPES)
    .not("processed_at", "is", null)
    .gt("amount_minor", 0)
    .gte("created_at", sinceIso);

  const bookingIdsByType: Record<"lab" | "pharmacy" | "referral", Set<string>> = {
    lab: new Set(),
    pharmacy: new Set(),
    referral: new Set(),
  };
  for (const t of txns ?? []) {
    const type = t.booking_order_type as "lab" | "pharmacy" | "referral" | null;
    if (type && t.booking_order_id) bookingIdsByType[type].add(t.booking_order_id);
  }

  const patientByBookingId = new Map<string, string>();
  const orgByBookingId = new Map<string, string>();
  if (bookingIdsByType.lab.size > 0) {
    const { data } = await supabase
      .from("lab_orders")
      .select("id, patient_id, organisation_id")
      .in("id", [...bookingIdsByType.lab]);
    for (const r of data ?? []) {
      patientByBookingId.set(r.id, r.patient_id);
      orgByBookingId.set(r.id, r.organisation_id);
    }
  }
  if (bookingIdsByType.pharmacy.size > 0) {
    const { data } = await supabase
      .from("pharmacy_orders")
      .select("id, patient_id, organisation_id")
      .in("id", [...bookingIdsByType.pharmacy]);
    for (const r of data ?? []) {
      patientByBookingId.set(r.id, r.patient_id);
      orgByBookingId.set(r.id, r.organisation_id);
    }
  }
  if (bookingIdsByType.referral.size > 0) {
    const { data } = await supabase
      .from("specialist_referrals")
      .select("id, patient_id, organisation_id")
      .in("id", [...bookingIdsByType.referral]);
    for (const r of data ?? []) {
      patientByBookingId.set(r.id, r.patient_id);
      orgByBookingId.set(r.id, r.organisation_id);
    }
  }

  for (const t of txns ?? []) {
    const sub = t.subscriptions as { subscriber_id: string | null } | null;
    const patientId =
      sub?.subscriber_id ?? (t.booking_order_id ? (patientByBookingId.get(t.booking_order_id) ?? null) : null);
    const groupKey = t.subscription_id
      ? `sub:${t.subscription_id}`
      : t.booking_order_type && t.booking_order_id
        ? `${t.booking_order_type}:${t.booking_order_id}`
        : null;
    events.push({
      id: t.id,
      source: "payment_transactions",
      organisationId: t.organisation_id ?? (t.booking_order_id ? (orgByBookingId.get(t.booking_order_id) ?? null) : null),
      patientId,
      groupKey,
      amountMinor: t.amount_minor ?? 0,
      currency: (t.currency as Currency) ?? "NGN",
      occurredAt: t.processed_at ?? t.created_at,
      paymentTransactionId: t.id,
    });
  }

  // ---- video consultations — not reachable through payment_transactions'
  // polymorphic booking_order_* columns (commission_type has no
  // 'consultation' member), so read directly. ----
  const { data: visits } = await supabase
    .from("video_visit_requests")
    .select("id, organisation_id, patient_id, amount_minor, currency, created_at")
    .gt("amount_minor", 0)
    .gte("created_at", sinceIso);
  for (const v of visits ?? []) {
    events.push({
      id: v.id,
      source: "video_visit_request",
      organisationId: v.organisation_id,
      patientId: v.patient_id,
      groupKey: `video:${v.id}`,
      amountMinor: v.amount_minor,
      currency: (v.currency as Currency) ?? "NGN",
      occurredAt: v.created_at,
      paymentTransactionId: null,
    });
  }

  // ---- care voucher instalments the payer made for themselves or a
  // beneficiary — velocity/unusual-amount still care who *paid*. ----
  const { data: vouchers } = await supabase
    .from("care_voucher_payments")
    .select("id, organisation_id, payer_profile_id, voucher_id, amount_minor, currency, status, created_at")
    .eq("status", "applied")
    .gte("created_at", sinceIso);
  for (const v of vouchers ?? []) {
    events.push({
      id: v.id,
      source: "care_voucher_payment",
      organisationId: v.organisation_id,
      patientId: v.payer_profile_id,
      groupKey: `voucher:${v.voucher_id}`,
      amountMinor: v.amount_minor,
      currency: (v.currency as Currency) ?? "NGN",
      occurredAt: v.created_at,
      paymentTransactionId: null,
    });
  }

  return events;
}

export function detectDuplicateTransactions(events: NormalizedEvent[]): SignalWrite[] {
  // Only payment_transactions carries a real double-charge risk (a replayed
  // or double-fired webhook) — video/voucher rows are already 1:1 with a
  // specific booking/instalment by construction.
  const groups = new Map<string, NormalizedEvent[]>();
  for (const e of events) {
    if (e.source !== "payment_transactions" || !e.groupKey) continue;
    const key = `${e.groupKey}:${e.amountMinor}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(e);
  }

  const signals: SignalWrite[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
    for (let i = 1; i < sorted.length; i++) {
      const gapMs = Date.parse(sorted[i].occurredAt) - Date.parse(sorted[i - 1].occurredAt);
      if (gapMs <= DUPLICATE_WINDOW_MS) {
        signals.push({
          organisation_id: sorted[i].organisationId,
          patient_id: sorted[i].patientId,
          signal_type: "duplicate_transaction",
          severity: "high",
          dedupe_key: `dup:${key}:${sorted[i - 1].id}:${sorted[i].id}`,
          payment_transaction_id: sorted[i].paymentTransactionId,
          amount_minor: sorted[i].amountMinor,
          currency: sorted[i].currency,
          detail: {
            note: "Two successful charges against the same subscription/booking, same amount, within 30 minutes.",
            group_key: key,
            transaction_ids: [sorted[i - 1].id, sorted[i].id],
          },
        });
      }
    }
  }
  return signals;
}

export function detectRapidVelocity(events: NormalizedEvent[]): SignalWrite[] {
  const byPatient = new Map<string, NormalizedEvent[]>();
  for (const e of events) {
    if (!e.patientId) continue;
    (byPatient.get(e.patientId) ?? byPatient.set(e.patientId, []).get(e.patientId)!).push(e);
  }

  const signals: SignalWrite[] = [];
  for (const [patientId, list] of byPatient) {
    const sorted = [...list].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
    for (let i = 0; i + VELOCITY_THRESHOLD - 1 < sorted.length; i++) {
      const windowStart = Date.parse(sorted[i].occurredAt);
      const windowEnd = Date.parse(sorted[i + VELOCITY_THRESHOLD - 1].occurredAt);
      if (windowEnd - windowStart <= VELOCITY_WINDOW_MS) {
        const day = sorted[i + VELOCITY_THRESHOLD - 1].occurredAt.slice(0, 10);
        signals.push({
          organisation_id: sorted[i].organisationId,
          patient_id: patientId,
          signal_type: "rapid_velocity",
          severity: "medium",
          dedupe_key: `velocity:${patientId}:${day}`,
          payment_transaction_id: null,
          amount_minor: null,
          currency: null,
          detail: {
            note: `${VELOCITY_THRESHOLD} or more successful payments from the same patient within an hour.`,
            event_ids: sorted.slice(i, i + VELOCITY_THRESHOLD).map((e) => e.id),
          },
        });
        break; // one flag per patient per day is enough signal
      }
    }
  }
  return signals;
}

async function detectRefundConcentration(supabase: SupabaseClient<Database>, sinceIso: string): Promise<SignalWrite[]> {
  const counts = new Map<string, { organisationId: string | null; count: number }>();

  const { data: labRefunds } = await supabase
    .from("lab_order_refunds")
    .select("lab_orders(patient_id, organisation_id)")
    .in("status", ["approved", "paid"])
    .gte("requested_at", sinceIso);
  for (const r of labRefunds ?? []) {
    const lo = r.lab_orders as { patient_id: string; organisation_id: string } | null;
    if (!lo) continue;
    const entry = counts.get(lo.patient_id) ?? { organisationId: lo.organisation_id, count: 0 };
    entry.count += 1;
    counts.set(lo.patient_id, entry);
  }

  const { data: refundedVisits } = await supabase
    .from("video_visit_requests")
    .select("patient_id, organisation_id")
    .eq("refund_status", "refunded")
    .gte("updated_at", sinceIso);
  for (const v of refundedVisits ?? []) {
    const entry = counts.get(v.patient_id) ?? { organisationId: v.organisation_id, count: 0 };
    entry.count += 1;
    counts.set(v.patient_id, entry);
  }

  const signals: SignalWrite[] = [];
  const week = isoWeekBucket(new Date());
  for (const [patientId, entry] of counts) {
    if (entry.count < REFUND_CONCENTRATION_THRESHOLD) continue;
    signals.push({
      organisation_id: entry.organisationId,
      patient_id: patientId,
      signal_type: "refund_concentration",
      severity: "medium",
      dedupe_key: `refund_conc:${patientId}:${week}`,
      payment_transaction_id: null,
      amount_minor: null,
      currency: null,
      detail: {
        note: `${entry.count} approved/paid refunds for the same patient in the last 30 days.`,
        refund_count_30d: entry.count,
      },
    });
  }
  return signals;
}

export function detectUnusualAmounts(events: NormalizedEvent[], freshSinceIso: string): SignalWrite[] {
  const byOrg = new Map<string, number[]>();
  for (const e of events) {
    if (!e.organisationId) continue;
    (byOrg.get(e.organisationId) ?? byOrg.set(e.organisationId, []).get(e.organisationId)!).push(e.amountMinor);
  }

  const signals: SignalWrite[] = [];
  for (const e of events) {
    if (!e.organisationId || Date.parse(e.occurredAt) < Date.parse(freshSinceIso)) continue;
    const orgAmounts = byOrg.get(e.organisationId) ?? [];
    const orgMedian = median(orgAmounts);
    const threshold = Math.max(orgMedian * UNUSUAL_AMOUNT_MULTIPLE, UNUSUAL_AMOUNT_FLOOR_MINOR);
    if (e.amountMinor > threshold) {
      signals.push({
        organisation_id: e.organisationId,
        patient_id: e.patientId,
        signal_type: "unusual_amount",
        severity: "low",
        dedupe_key: `unusual:${e.source}:${e.id}`,
        payment_transaction_id: e.paymentTransactionId,
        amount_minor: e.amountMinor,
        currency: e.currency,
        detail: {
          note: "This charge is well outside the organisation's normal payment range — worth a quick look, not necessarily wrong.",
          organisation_median_minor: Math.round(orgMedian),
          multiple_of_median: orgMedian > 0 ? Math.round((e.amountMinor / orgMedian) * 10) / 10 : null,
        },
      });
    }
  }
  return signals;
}

export async function runFraudDetectionSweep(supabase: SupabaseClient<Database>): Promise<FraudSweepTotals> {
  const now = Date.now();
  // 14-day overlap window for duplicate/velocity/baseline detection, same
  // overlap-over-gap posture as the reconciliation sweep — a run that fails
  // or lands mid-day costs a repeated check, never a gap.
  const since14d = new Date(now - 14 * 86_400_000).toISOString();
  const since30d = new Date(now - 30 * 86_400_000).toISOString();
  const freshSince2d = new Date(now - 2 * 86_400_000).toISOString();

  const events = await fetchNormalizedEvents(supabase, since14d);

  const signals = [
    ...detectDuplicateTransactions(events),
    ...detectRapidVelocity(events),
    ...(await detectRefundConcentration(supabase, since30d)),
    ...detectUnusualAmounts(events, freshSince2d),
  ];

  const signalsWritten = await writeSignals(supabase, signals);
  return { eventsScanned: events.length, signalsWritten };
}
