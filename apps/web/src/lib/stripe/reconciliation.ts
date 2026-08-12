import { getStripeClient, isStripeConfigured } from "./client";

export interface StripeEventSummary {
  id: string;
  type: string;
  amountMinor: number | null;
  currency: string | null;
  status: string;
}

const RECONCILED_EVENT_TYPES = ["checkout.session.completed", "invoice.payment_succeeded"] as const;

function extractAmount(
  eventType: string,
  obj: Record<string, unknown>,
): { amountMinor: number | null; currency: string | null } {
  const currency = typeof obj.currency === "string" ? obj.currency.toUpperCase() : null;
  if (eventType === "checkout.session.completed") {
    return { amountMinor: typeof obj.amount_total === "number" ? obj.amount_total : null, currency };
  }
  if (eventType === "invoice.payment_succeeded") {
    return { amountMinor: typeof obj.amount_paid === "number" ? obj.amount_paid : null, currency };
  }
  return { amountMinor: null, currency };
}

export type StripeReconciliationResult =
  | { ok: true; data: StripeEventSummary[] }
  | { ok: false; error: string };

/**
 * Lists Stripe *events* (not charges) in a time window, for the
 * reconciliation sweep only — apps/web/src/lib/finance/reconciliation-sweep.ts.
 * Deliberately events, not Charges API objects: supabase/functions/
 * stripe-webhook/index.ts stores `provider_event_id = event.id`, not a
 * charge id (that function's own header comment: "event.id is always
 * present and stable, unlike Paystack's fallback chain"), so comparing
 * against the Charges list would never line up with what's stored locally.
 * Scoped to the same two event types finance_risk_flags()/
 * finance_reconciliation_summary() already treat as "a real payment
 * happened" — not subscription.created/updated/deleted, which carry no
 * charge amount to compare.
 *
 * stripe-node's list methods return an async-iterable that auto-paginates
 * on its own; capped at 5,000 total events per run as a safety bound
 * against a runaway loop, matching the Paystack sweep's own cap.
 */
export async function listReconciliationEvents(args: {
  gteUnixSeconds: number;
  lteUnixSeconds: number;
}): Promise<StripeReconciliationResult> {
  if (!isStripeConfigured()) {
    return { ok: false, error: "STRIPE_SECRET_KEY is not configured" };
  }
  const stripe = getStripeClient();
  if (!stripe) {
    return { ok: false, error: "STRIPE_SECRET_KEY is not configured" };
  }

  const out: StripeEventSummary[] = [];
  try {
    for (const eventType of RECONCILED_EVENT_TYPES) {
      for await (const event of stripe.events.list({
        type: eventType,
        created: { gte: args.gteUnixSeconds, lte: args.lteUnixSeconds },
        limit: 100,
      })) {
        const obj = event.data.object as unknown as Record<string, unknown>;
        const { amountMinor, currency } = extractAmount(event.type, obj);
        out.push({
          id: event.id,
          type: event.type,
          amountMinor,
          currency,
          status: typeof obj.status === "string" ? obj.status : "succeeded",
        });
        if (out.length >= 5000) return { ok: true, data: out };
      }
    }
    return { ok: true, data: out };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown Stripe list failure" };
  }
}
