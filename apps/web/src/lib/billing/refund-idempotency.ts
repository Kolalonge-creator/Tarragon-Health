/**
 * The one derivation of a refund's idempotency key, shared by the two routes
 * that can post a refund reversal:
 *
 *   * the refund crons (apps/web/src/lib/billing/refund-posting.ts), which
 *     see Paystack's POST /refund API RESPONSE;
 *   * the Paystack webhook (supabase/functions/paystack-webhook/index.ts),
 *     which sees the refund.* WEBHOOK PAYLOAD.
 *
 * Both write into payment_transactions, whose unique
 * (provider, provider_event_id) index is the only thing preventing one refund
 * from posting Dr 4900 / Cr 1020 twice. That protection is real only while
 * the two routes derive the SAME string, so the derivation lives here and is
 * mirrored verbatim into the webhook (see the drift guard in
 * refund-idempotency.test.ts — the edge function is deployed by the Supabase
 * CLI and cannot import from apps/web).
 *
 * WHY THE KEY IS (original charge reference, amount) AND NOT THE REFUND ID
 *
 * The first version keyed on Paystack's own refund id: `refund:<data.id>`.
 * The API response does carry `id`. The refund.* webhook body, in the shape
 * Paystack's integrators actually report, does not — it carries
 * `transaction_reference` and `refund_reference`, and `refund_reference` is
 * not a field the /refund response returns, so the two sides can never agree
 * on it. The webhook therefore fell through to `rawBody.length`, which is not
 * a key at all: it is a different string from the cron's, so one refund
 * posted twice (verified: two rows for one 5,000 naira refund reversed
 * 10,000), and it is a collision key, so two unrelated refunds whose bodies
 * happen to be the same byte length would have silently deduped each other.
 *
 * The original charge's reference plus the refunded amount is the only
 * identity both sides genuinely hold. Its one blind spot is two separate
 * refunds of the SAME charge for the SAME amount, which collapse to one key.
 * That direction fails safe (a reversal is missed, leaving a visible residual
 * on the account, rather than money being reversed twice) and it is surfaced
 * rather than swallowed: recordRefundLedgerEntry reports the conflict back to
 * its caller as `alreadyPosted`, and each refund cron counts it in its
 * response. None of the three crons can produce it today — each refunds one
 * order row once and flips its status in the same pass.
 *
 * A payload carrying neither a usable reference nor a positive integer amount
 * yields null. Null is a hard stop on both sides, never a fallback key: the
 * cron refuses to write a row, and the webhook records the event for audit
 * without ever marking it processed, so no reversal can post from a payload
 * we cannot identify.
 */

// >>> BEGIN SHARED REFUND IDEMPOTENCY (mirrored verbatim in supabase/functions/paystack-webhook/index.ts)
export interface RefundWebhookData {
  transaction_reference?: string | null;
  transaction?: { reference?: string | null } | null;
  reference?: string | null;
  amount?: number | string | null;
}

/**
 * A refunded amount in the currency's minor unit, or null when the payload
 * does not carry one we can post against. Paystack sends `amount` as a JSON
 * number on some events and as a decimal string on others.
 */
export function refundAmountMinor(raw: number | string | null | undefined): number | null {
  const amount = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) return null;
  return amount;
}

/**
 * `refund:<original charge reference>:<amount in minor units>`, or null when
 * the refund cannot be identified. Never guess a key: null means "do not
 * post."
 */
export function refundIdempotencyKey(identity: {
  chargeReference: string | null | undefined;
  amountMinor: number | string | null | undefined;
}): string | null {
  const reference =
    typeof identity.chargeReference === "string" ? identity.chargeReference.trim() : "";
  if (reference === "") return null;
  const amount = refundAmountMinor(identity.amountMinor);
  if (amount === null) return null;
  return `refund:${reference}:${amount}`;
}

/**
 * The webhook's half. Candidates for the original charge's reference, in
 * order: `transaction_reference` (the field the refund.* payload actually
 * carries), then a nested `transaction.reference` (the shape the dispute
 * events use), then a flat `reference`. On a refund event all three mean the
 * ORIGINAL charge, never the refund itself.
 */
export function refundIdempotencyKeyFromWebhook(
  data: RefundWebhookData | null | undefined,
): string | null {
  return refundIdempotencyKey({
    chargeReference:
      data?.transaction_reference ?? data?.transaction?.reference ?? data?.reference ?? null,
    amountMinor: data?.amount ?? null,
  });
}

/**
 * The provider_event_id an individual refund.* EVENT is recorded under.
 *
 * Only `refund.processed` may carry the bare key, because only a completed
 * refund posts the reversal and only it must collide with what the cron
 * writes. `refund.pending` and `refund.failed` describe the same refund and
 * would otherwise derive the same string: the pending row would win the
 * unique index, the processed event that followed would be dismissed as a
 * replay, and the reversal would never post at all. They are namespaced by
 * event name so all three are recorded and only one of them can post.
 */
export function refundProviderEventId(eventName: string, key: string): string {
  return eventName === "refund.processed" ? key : `${eventName}:${key}`;
}
// <<< END SHARED REFUND IDEMPOTENCY
