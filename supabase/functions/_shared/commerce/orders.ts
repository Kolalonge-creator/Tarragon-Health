import type { PaymentProvider } from "../integrations/payment.ts";
import { fail, ok, type ProviderResult } from "../integrations/result.ts";

/**
 * Order payment flow (S25, spec 10 "Paystack checkout"). Three callers reach the same writer: the signed webhook, the
 * return page and the sweeper. An order is paid only after Paystack's own verify call says so, for the right reference,
 * currency and price, and a fee that does not exceed what the processor took. The database function
 * `record_order_payment` makes it idempotent (safety case 24) and re-checks the price against the order; this module never
 * decides "paid" by itself and never trusts the order of events or a browser redirect.
 */
export type PaymentSource = "webhook" | "return" | "sweep";

export interface RecordPaymentInput {
  readonly reference: string;
  readonly amountKobo: number;
  readonly feeKobo: number;
  readonly totalKobo: number;
  readonly currency: string;
  readonly source: PaymentSource;
  readonly eventKey: string | null;
  readonly paidAt: string | null;
  readonly raw: Readonly<Record<string, unknown>>;
}
export interface MismatchInput {
  readonly reference: string;
  readonly reason: string;
  readonly amountKobo: number;
  readonly totalKobo: number;
  readonly source: PaymentSource;
  readonly eventKey: string | null;
}
export type RecordResult = "paid" | "replay" | "mismatch" | "not_found" | "not_paid";
export interface RecordOutcome {
  readonly result: RecordResult;
  readonly orderId: string | null;
  readonly reason: string | null;
}
export interface OpenOrder {
  readonly reference: string;
  readonly orderId: string;
  readonly expired: boolean;
}

/** What the flows need from the database. The Supabase implementation is in supabase-store.ts. */
export interface OrderStore {
  record(input: RecordPaymentInput): Promise<ProviderResult<RecordOutcome>>;
  flagMismatch(input: MismatchInput): Promise<ProviderResult<RecordOutcome>>;
  close(reference: string, reason: "abandoned" | "failed" | "expired"): Promise<ProviderResult<boolean>>;
  listOpen(limit: number): Promise<ProviderResult<readonly OpenOrder[]>>;
  setCheckoutUrl(reference: string, url: string): Promise<ProviderResult<boolean>>;
}

export interface CommerceDeps {
  readonly payments: PaymentProvider;
  readonly store: OrderStore;
}

export type ConfirmOutcome =
  | { readonly outcome: "paid" | "replay"; readonly orderId: string | null }
  | { readonly outcome: "mismatch"; readonly reason: string | null; readonly orderId: string | null }
  /** Paystack has no such charge, or the order is unknown to us. Nothing was written. */
  | { readonly outcome: "not_found" }
  /** Still waiting for the customer (a bank transfer or USSD can settle later). Ask again later. */
  | { readonly outcome: "pending" }
  /** Paystack says the charge failed, was abandoned or reversed. */
  | { readonly outcome: "unpaid"; readonly status: "failed" | "abandoned" | "reversed" }
  /** A call to Paystack or the database failed. Safe to repeat; the caller should ask for a retry (a 5xx to a webhook). */
  | { readonly outcome: "retry"; readonly where: "provider" | "store" };

export async function confirmPayment(
  deps: CommerceDeps,
  args: { readonly reference: string; readonly source: PaymentSource; readonly eventKey?: string | null },
): Promise<ConfirmOutcome> {
  const eventKey = args.eventKey ?? null;
  const verified = await deps.payments.verifyTransaction(args.reference);
  if (!verified.ok) {
    return verified.error.code === "not_found" ? { outcome: "not_found" } : { outcome: "retry", where: "provider" };
  }
  const v = verified.data;
  if (v.status === "pending") return { outcome: "pending" };
  if (v.status !== "success") return { outcome: "unpaid", status: v.status };

  const customerFeeKobo = v.amountKobo - v.requestedAmountKobo;
  const reason =
    v.reference !== args.reference ? "reference"
    : v.currency !== "NGN" ? "currency"
    : customerFeeKobo < 0 || customerFeeKobo > v.feesKobo ? "fee"
    : null;
  if (reason !== null) {
    const flagged = await deps.store.flagMismatch({ reference: args.reference, reason, amountKobo: v.requestedAmountKobo, totalKobo: v.amountKobo, source: args.source, eventKey });
    if (!flagged.ok) return { outcome: "retry", where: "store" };
    return flagged.data.result === "not_found" ? { outcome: "not_found" } : { outcome: "mismatch", reason, orderId: flagged.data.orderId };
  }

  const recorded = await deps.store.record({
    reference: args.reference,
    amountKobo: v.requestedAmountKobo,
    feeKobo: customerFeeKobo,
    totalKobo: v.amountKobo,
    currency: v.currency,
    source: args.source,
    eventKey,
    paidAt: v.paidAt,
    // A minimised record: ids, amounts and the processor's own fee. Never the customer, card or bank block.
    raw: { reference: v.reference, status: v.status, currency: v.currency, processor_fee_kobo: v.feesKobo, paid_at: v.paidAt },
  });
  if (!recorded.ok) return { outcome: "retry", where: "store" };
  const r = recorded.data;
  switch (r.result) {
    case "paid":
    case "replay":
      return { outcome: r.result, orderId: r.orderId };
    case "mismatch":
      return { outcome: "mismatch", reason: r.reason, orderId: r.orderId };
    case "not_found":
      return { outcome: "not_found" };
    case "not_paid":
      return { outcome: "pending" };
  }
}

export type WebhookOutcome =
  | { readonly handled: false; readonly reason: "invalid_signature" | "not_an_order_event" }
  | { readonly handled: true; readonly confirm: ConfirmOutcome };

/**
 * A raw Paystack webhook body. Handled only when its signature is good AND it is a `charge.success` for one of our v5 orders
 * (`metadata.kind = "order"`). Anything else is not ours and `handled` is false, so the legacy handler can carry on.
 */
export async function handleOrderWebhook(deps: CommerceDeps, rawBody: string, signature: string | null): Promise<WebhookOutcome> {
  const parsed = await deps.payments.parseWebhook(rawBody, signature);
  if (!parsed.ok) return { handled: false, reason: "invalid_signature" };
  const e = parsed.data;
  if (e.kind !== "charge_success" || e.metadata["kind"] !== "order") return { handled: false, reason: "not_an_order_event" };
  return { handled: true, confirm: await confirmPayment(deps, { reference: e.reference, source: "webhook", eventKey: e.key }) };
}

const SWEEP_CONCURRENCY = 5;

export interface ReconcileSummary {
  readonly checked: number;
  readonly paid: number;
  readonly closed: number;
  readonly mismatches: number;
  readonly stillPending: number;
  readonly errors: number;
}

/**
 * The safety net behind the webhook: unpaid orders are re-checked with Paystack (a bank transfer or USSD can settle long after
 * the customer left). An order is closed only when Paystack says it failed or was abandoned, or when it has expired and
 * Paystack has no such charge. One bad order never stops the rest.
 */
export async function reconcileOpenOrders(deps: CommerceDeps, limit = 50): Promise<ProviderResult<ReconcileSummary>> {
  const open = await deps.store.listOpen(limit);
  if (!open.ok) return fail("vendor_error", "Could not list open orders");
  let paid = 0, closed = 0, mismatches = 0, stillPending = 0, errors = 0;
  const one = async (o: OpenOrder) => {
    const c = await confirmPayment(deps, { reference: o.reference, source: "sweep" });
    switch (c.outcome) {
      case "paid":
        paid++;
        break;
      case "replay":
        break;
      case "mismatch":
        mismatches++;
        break;
      case "pending":
        stillPending++;
        break;
      case "unpaid": {
        const r = await deps.store.close(o.reference, c.status === "abandoned" ? "abandoned" : "failed");
        if (r.ok && r.data) closed++;
        else if (!r.ok) errors++;
        break;
      }
      case "not_found":
        if (o.expired) {
          const r = await deps.store.close(o.reference, "expired");
          if (r.ok && r.data) closed++;
          else if (!r.ok) errors++;
        } else stillPending++;
        break;
      case "retry":
        errors++;
        break;
    }
  };
  // A few at a time: one slow Paystack call must not hold up the rest, and a pass must finish inside the cron call's timeout.
  for (let i = 0; i < open.data.length; i += SWEEP_CONCURRENCY) {
    await Promise.all(open.data.slice(i, i + SWEEP_CONCURRENCY).map(one));
  }
  return ok({ checked: open.data.length, paid, closed, mismatches, stillPending, errors });
}
