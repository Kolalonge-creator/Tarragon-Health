// Tarragon Health — Paystack webhook (Sprint 6: subscriptions/payments)
//
// Authoritative source of truth for subscription/add-on activation — never
// the browser redirect back from Paystack's hosted checkout (see
// checkout-callback/page.tsx, which only does a same-request UX check).
// Mirrors supabase/functions/whatsapp-webhook/index.ts's shape: signature-
// verified, never throws past its boundary, always returns 200 (Paystack
// retries on non-2xx — a transient DB hiccup should not retry-storm them),
// and every event is recorded to payment_transactions, including ones it
// fails to process, so nothing is ever silently dropped.
//
// Correlation notes (flagged for the real test-mode round trip — see the
// implementation plan's verification section):
//   - `charge.success` carries back the `metadata` set at
//     /transaction/initialize time (profile_id, kind, item_code,
//     subscription_id) and `data.reference`, which matches the
//     `pending_provider_ref` written on our row at checkout-initiate time.
//     This is the one 100%-reliable correlation path, so it's what actually
//     activates a row (status -> 'active').
//   - `subscription.create` (fired by Paystack around the same time) is the
//     only event carrying the real `subscription_code`/`email_token` needed
//     later for cancellation, but its payload does NOT echo back our
//     metadata. It's correlated best-effort by matching the most recently
//     not-yet-enriched row for the same Paystack plan code. Confirmed via a
//     real test-mode round trip (2026-07-13) that `subscription.create` can
//     arrive and get processed a couple of ms *before* `charge.success` —
//     so this match deliberately checks status IN ('trialing', 'active'),
//     not just 'active', or the still-trialing row at that instant would
//     never be found and the row would stay permanently un-enriched (the
//     failure mode actually observed before this fix: a patient's
//     self-cancel would silently only ever mark our own row cancelled,
//     never touching the still-live Paystack subscription). If the
//     heuristic still doesn't hold in some other ordering, this event stays
//     logged to payment_transactions (never dropped) but the row goes
//     un-enriched until reconciled.
//   - `invoice.payment_failed` / `subscription.disable` / `subscription.not_renew`
//     carry the subscription_code, matched against `provider_ref` (set by
//     the subscription.create enrichment above).

import { createClient } from "jsr:@supabase/supabase-js@2";

type CheckoutKind = "subscription" | "add_on" | "booking";
type BookingOrderType = "lab" | "pharmacy" | "referral" | "video_visit" | "lab_result_consult";

interface CheckoutMetadata {
  kind?: CheckoutKind;
  profile_id?: string;
  item_code?: string;
  subscription_id?: string;
  booking_order_id?: string;
  booking_order_type?: BookingOrderType;
}

const BOOKING_TABLE: Record<
  BookingOrderType,
  | "lab_orders"
  | "pharmacy_orders"
  | "specialist_referrals"
  | "video_visit_requests"
  | "lab_result_consult_requests"
> = {
  lab: "lab_orders",
  pharmacy: "pharmacy_orders",
  referral: "specialist_referrals",
  // 'payment_confirmed' on a video_visit_request means the payment is HELD —
  // the visit only books when a doctor accepts (accept_video_visit_request);
  // decline/expiry refunds it. Same column contract as the order tables.
  video_visit: "video_visit_requests",
  // 'payment_confirmed' on a lab_result_consult_request unlocks exactly one
  // self-arranged result upload (public.claim_lab_result_consult_credit) —
  // same held-then-consumed shape as video_visit above, no slot to book.
  lab_result_consult: "lab_result_consult_requests",
};

interface PaystackEvent {
  event: string;
  data: {
    reference?: string;
    amount?: number;
    currency?: string;
    metadata?: CheckoutMetadata | null;
    plan?: { plan_code?: string } | string | null;
    subscription_code?: string;
    email_token?: string;
    // On invoice.* events the subscription sub-object carries the code +
    // the next billing date; on subscription.* events those live at the top.
    subscription?: { subscription_code?: string; next_payment_date?: string } | null;
    customer?: { email?: string } | null;
    next_payment_date?: string;
    paid?: boolean;
    status?: string;
    id?: number | string;
    // Only present on charge.dispute.create — the original charge, if
    // Paystack's payload nests it here (see the dispute case below).
    transaction?: { reference?: string } | null;
    // The refund.* payload's own name for the ORIGINAL charge's reference.
    // This is the field that identifies a refund; `id` is not present on
    // these events, which is what made the old `refund:${data.id}` key fall
    // through to a body length. See refundIdempotencyKeyFromWebhook.
    transaction_reference?: string;
  };
}

async function verifySignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  const secret = Deno.env.get("PAYSTACK_WEBHOOK_SECRET");
  // Fail closed, unlike whatsapp-webhook's degrade-open: a forged event here
  // activates a real subscription/add-on for free, not just a fake chat
  // message, so an unconfigured secret must reject every request.
  if (!secret) {
    console.error("paystack-webhook: PAYSTACK_WEBHOOK_SECRET is not set — rejecting all events");
    return false;
  }
  if (!signatureHeader) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return signatureHeader === expected;
}

function intervalToMs(interval: string | null): number {
  return interval === "yearly" ? 365 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
}

/**
 * Every label public.payment_transaction_type actually carries. The insert
 * below used to write `event.event` verbatim, which meant any event name
 * Postgres did not recognise made the whole INSERT fail with 22P02 — and the
 * handler only tolerates 23505 (its idempotency conflict), so it returned
 * `record_failed` and recorded NOTHING. That is exactly how every refund
 * event was lost: the enum had no 'refund.*' label at all until migration
 * 20260905000134, so `private.finance_post_from_payment`'s refund branch
 * (Dr 4900 Refunds / Cr 1020 Cash) could never fire, and refunded money sat
 * on the ledger as cash and revenue that was not in the bank.
 *
 * Adding the labels fixes today's gap; coercing an unrecognised name to
 * 'other' fixes the next one — a payload Paystack adds tomorrow now lands in
 * payment_transactions with its true name preserved in raw_payload.event,
 * instead of being dropped on the floor. This restores the promise this
 * file's own header already makes: "every event is recorded to
 * payment_transactions, including ones it fails to process."
 */
const PAYMENT_TRANSACTION_TYPES = new Set([
  "charge.success",
  "charge.failed",
  "subscription.create",
  "subscription.disable",
  "subscription.not_renew",
  "invoice.create",
  "invoice.update",
  "invoice.payment_failed",
  "invoice.payment_succeeded",
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "charge.dispute.create",
  "charge.dispute.created",
  "refund.pending",
  "refund.processed",
  "refund.failed",
  "transfer.success",
  "transfer.failed",
  "transfer.reversed",
  "other",
]);

function toEventType(event: string | undefined): string {
  return event && PAYMENT_TRANSACTION_TYPES.has(event) ? event : "other";
}

/**
 * The refund idempotency key, MIRRORED VERBATIM from
 * apps/web/src/lib/billing/refund-idempotency.ts, which is the canonical
 * copy and carries the full reasoning. It is duplicated rather than imported
 * because this edge function is deployed by the Supabase CLI and cannot
 * import from apps/web; the two copies are held identical by a drift-guard
 * test (apps/web/src/lib/billing/refund-idempotency.test.ts) that reads this
 * file and compares the text between the markers byte for byte. Edit the
 * canonical file and copy the block across — never edit only one side.
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

/**
 * Content hash of the raw body, used as a last-resort provider_event_id when
 * an event carries no identifier of its own. Deduplicates a genuine Paystack
 * retry of the identical body and nothing else — unlike the body LENGTH this
 * replaced, which collided across unrelated events.
 */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const rawBody = await req.text();
  const signatureValid = await verifySignature(rawBody, req.headers.get("x-paystack-signature"));

  if (!signatureValid) {
    return Response.json({ ok: false, error: "invalid_signature" }, { status: 200 });
  }

  let event: PaystackEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 200 });
  }

  const isRefundEvent = typeof event.event === "string" && event.event.startsWith("refund.");

  // A refund is keyed by the shared derivation the refund crons use when they
  // post their own ledger reversal (apps/web/src/lib/billing/refund-posting.ts
  // -> refund-idempotency.ts, mirrored verbatim above). Both routes therefore
  // reach the SAME row, and the unique (provider, provider_event_id) index
  // makes whichever arrives second an idempotent no-op instead of a second,
  // duplicate Dr 4900 / Cr 1020 posting.
  const refundKey = isRefundEvent ? refundIdempotencyKeyFromWebhook(event.data) : null;

  if (isRefundEvent && refundKey === null) {
    // A refund payload carrying neither a usable original-charge reference
    // nor a positive integer amount. There is no key here, and inventing one
    // (this used to fall back to the body's BYTE LENGTH) is worse than having
    // none: it does not match what the cron writes, so the same refund posts
    // twice, and two unrelated refunds of equal length dedupe each other.
    //
    // So: record it for audit, exactly as this file's header promises, under
    // a content hash that cannot collide with a real refund key — and return
    // before the processing block below, so processed_at is never set and
    // finance_post_from_payment can never take its refund branch. A reversal
    // we cannot identify is a human's problem, loudly, not a guess.
    console.error(
      "paystack-webhook: refund event with no usable charge reference or amount — recorded for audit, NOT posted",
      { event: event.event, keys: Object.keys(event.data ?? {}) },
    );
    const { error: auditError } = await supabase.from("payment_transactions").insert({
      provider: "paystack",
      provider_event_id: `refund:unidentifiable:sha256:${await sha256Hex(rawBody)}`,
      event_type: toEventType(event.event),
      amount_minor: refundAmountMinor(event.data?.amount),
      currency: (event.data?.currency as "NGN" | "GBP" | "USD" | undefined) ?? null,
      raw_payload: event as unknown as Record<string, unknown>,
    });
    if (auditError && auditError.code !== "23505") {
      console.error("paystack-webhook: failed to record unidentifiable refund", auditError);
    }
    return Response.json({ ok: false, error: "refund_unidentifiable" }, { status: 200 });
  }

  const providerEventId = (refundKey !== null ? refundProviderEventId(event.event, refundKey) : null) ??
    (event.data?.reference ??
      (event.data?.id !== undefined ? String(event.data.id) : null) ??
      event.data?.subscription_code ??
      // Same reasoning as the refund key above, for every other event type: a
      // body length is a collision key, so two unrelated identifier-less
      // events of equal length would silently dedupe each other. A content
      // hash still collapses a genuine Paystack retry of the same body, which
      // is the only deduplication this fallback is meant to provide.
      `${event.event}:sha256:${await sha256Hex(rawBody)}`);

  // Idempotency: a replayed webhook (Paystack retries, or a manual resend
  // from their dashboard) is a guaranteed no-op — the unique constraint on
  // (provider, provider_event_id) makes this insert fail silently via
  // on_conflict, and no row means "already handled, stop here."
  const { data: txnRow, error: insertError } = await supabase
    .from("payment_transactions")
    .insert({
      provider: "paystack",
      provider_event_id: providerEventId,
      event_type: toEventType(event.event),
      amount_minor: isRefundEvent
        ? refundAmountMinor(event.data?.amount)
        : (event.data?.amount ?? null),
      currency: (event.data?.currency as "NGN" | "GBP" | "USD" | undefined) ?? null,
      raw_payload: event as unknown as Record<string, unknown>,
    })
    .select("id")
    .maybeSingle();

  if (insertError && insertError.code !== "23505") {
    // Not a duplicate-key conflict — a real DB problem. Still 200 (avoid a
    // Paystack retry storm) but nothing was recorded; surfaced via function
    // logs for manual follow-up.
    console.error("paystack-webhook: failed to record event", insertError);
    return Response.json({ ok: false, error: "record_failed" }, { status: 200 });
  }
  if (!txnRow) {
    // Conflict — this event id was already processed. No-op.
    return Response.json({ ok: true, replay: true });
  }

  const markProcessed = (patch: Record<string, unknown> = {}) =>
    supabase.from("payment_transactions").update({ processed_at: new Date().toISOString(), ...patch }).eq("id", txnRow.id);
  const markFailed = (error: string) =>
    supabase.from("payment_transactions").update({ error }).eq("id", txnRow.id);

  const metadata = event.data?.metadata ?? null;

  try {
    switch (event.event) {
      case "charge.success": {
        if (!metadata?.kind || !event.data.reference) {
          await markFailed("charge.success missing metadata.kind or reference — not a subscription checkout");
          break;
        }

        if (metadata.kind === "booking") {
          const bookingOrderType = metadata.booking_order_type;
          if (!bookingOrderType) {
            await markFailed("booking charge.success missing metadata.booking_order_type");
            break;
          }
          const table = BOOKING_TABLE[bookingOrderType];
          const { data: row } = await supabase
            .from(table)
            .select("id, organisation_id")
            .eq("pending_payment_provider_ref", event.data.reference)
            .maybeSingle();

          if (!row) {
            await markFailed(`no ${table} row with pending_payment_provider_ref=${event.data.reference}`);
            break;
          }

          await supabase
            .from(table)
            .update({
              status: "payment_confirmed",
              payment_provider: "paystack",
              payment_provider_ref: event.data.reference,
              pending_payment_provider_ref: null,
            })
            .eq("id", row.id);

          await markProcessed({
            organisation_id: row.organisation_id,
            booking_order_id: row.id,
            booking_order_type: bookingOrderType,
          });
        } else if (metadata.kind === "subscription") {
          const { data: row } = await supabase
            .from("subscriptions")
            .select("id, organisation_id, interval")
            .eq("pending_provider_ref", event.data.reference)
            .maybeSingle();

          if (!row) {
            await markFailed(`no subscriptions row with pending_provider_ref=${event.data.reference}`);
            break;
          }

          await supabase
            .from("subscriptions")
            .update({
              status: "active",
              provider: "paystack",
              provider_ref: event.data.reference,
              pending_provider_ref: null,
              current_period_end: new Date(
                Date.now() + intervalToMs(row.interval),
              ).toISOString(),
            })
            .eq("id", row.id);

          await markProcessed({ organisation_id: row.organisation_id, subscription_id: row.id });
        } else {
          const { data: row } = await supabase
            .from("subscription_add_ons")
            .select("id, organisation_id, interval")
            .eq("pending_provider_ref", event.data.reference)
            .maybeSingle();

          if (!row) {
            await markFailed(`no subscription_add_ons row with pending_payment_provider_ref=${event.data.reference}`);
            break;
          }

          await supabase
            .from("subscription_add_ons")
            .update({
              status: "active",
              provider: "paystack",
              provider_ref: event.data.reference,
              pending_provider_ref: null,
              current_period_end: new Date(
                Date.now() + intervalToMs(row.interval),
              ).toISOString(),
            })
            .eq("id", row.id);

          await markProcessed({ organisation_id: row.organisation_id, subscription_add_on_id: row.id });
        }
        break;
      }

      case "subscription.create": {
        // Best-effort enrichment — see the correlation notes at the top of
        // this file. Not required for activation (charge.success already
        // did that); only needed so cancellation can work later.
        const planCode =
          typeof event.data.plan === "string" ? event.data.plan : event.data.plan?.plan_code;
        const subscriptionCode = event.data.subscription_code;
        const emailToken = event.data.email_token;

        if (!planCode || !subscriptionCode || !emailToken) {
          await markFailed("subscription.create missing plan_code/subscription_code/email_token");
          break;
        }

        const { data: planMatch } = await supabase
          .from("subscription_plans")
          .select("id")
          .eq("paystack_plan_code", planCode)
          .maybeSingle();

        if (planMatch) {
          const { data: candidate } = await supabase
            .from("subscriptions")
            .select("id")
            .eq("plan_id", planMatch.id)
            .eq("provider", "paystack")
            .in("status", ["trialing", "active"])
            .is("provider_email_token", null)
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (candidate) {
            await supabase
              .from("subscriptions")
              .update({ provider_ref: subscriptionCode, provider_email_token: emailToken })
              .eq("id", candidate.id);
            await markProcessed({ subscription_id: candidate.id });
            break;
          }
        }

        const { data: addOnMatch } = await supabase
          .from("add_ons")
          .select("id")
          .eq("paystack_plan_code", planCode)
          .maybeSingle();

        if (addOnMatch) {
          const { data: candidate } = await supabase
            .from("subscription_add_ons")
            .select("id")
            .eq("add_on_id", addOnMatch.id)
            .eq("provider", "paystack")
            .in("status", ["trialing", "active"])
            .is("provider_email_token", null)
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (candidate) {
            await supabase
              .from("subscription_add_ons")
              .update({ provider_ref: subscriptionCode, provider_email_token: emailToken })
              .eq("id", candidate.id);
            await markProcessed({ subscription_add_on_id: candidate.id });
            break;
          }
        }

        await markFailed(`could not correlate subscription.create (plan_code=${planCode}) to a local row`);
        break;
      }

      case "invoice.update": {
        // Paystack's canonical "a subscription was billed" signal for a
        // RENEWAL. The first charge is handled by charge.success above (keyed
        // on pending_provider_ref); every subsequent auto-renewal arrives here
        // with paid=true and the subscription_code that provider_ref was
        // enriched to by subscription.create — advance current_period_end so
        // the "renews on {date}" line stays accurate and a past_due row that
        // just recovered flips back to active. A failed renewal comes through
        // invoice.payment_failed instead, so only act on the paid case.
        if (event.data.paid !== true && event.data.status !== "success") {
          await markProcessed({});
          break;
        }
        const renewalCode = event.data.subscription?.subscription_code ?? event.data.subscription_code;
        if (!renewalCode) {
          await markFailed("invoice.update missing subscription_code");
          break;
        }
        const nextPaymentDate =
          event.data.subscription?.next_payment_date ?? event.data.next_payment_date ?? null;

        const { data: subRow } = await supabase
          .from("subscriptions")
          .select("id, interval, cancel_at_period_end")
          .eq("provider_ref", renewalCode)
          .maybeSingle();
        if (subRow) {
          // A row already scheduled to cancel must not be revived by a stray
          // paid invoice — leave its status/flag alone, just refresh the date.
          const patch: Record<string, unknown> = {
            current_period_end: nextPaymentDate
              ? new Date(nextPaymentDate).toISOString()
              : new Date(Date.now() + intervalToMs(subRow.interval)).toISOString(),
          };
          if (!subRow.cancel_at_period_end) patch.status = "active";
          await supabase.from("subscriptions").update(patch).eq("id", subRow.id);
          await markProcessed({ subscription_id: subRow.id });
          break;
        }

        const { data: addRow } = await supabase
          .from("subscription_add_ons")
          .select("id, interval, cancel_at_period_end")
          .eq("provider_ref", renewalCode)
          .maybeSingle();
        if (addRow) {
          const patch: Record<string, unknown> = {
            current_period_end: nextPaymentDate
              ? new Date(nextPaymentDate).toISOString()
              : new Date(Date.now() + intervalToMs(addRow.interval)).toISOString(),
          };
          if (!addRow.cancel_at_period_end) patch.status = "active";
          await supabase.from("subscription_add_ons").update(patch).eq("id", addRow.id);
          await markProcessed({ subscription_add_on_id: addRow.id });
          break;
        }
        await markFailed(`invoice.update: no row with provider_ref=${renewalCode}`);
        break;
      }

      case "invoice.payment_failed": {
        const subscriptionCode = event.data.subscription?.subscription_code ?? event.data.subscription_code;
        if (!subscriptionCode) {
          await markFailed("invoice.payment_failed missing subscription_code");
          break;
        }
        const { data: subRow } = await supabase
          .from("subscriptions")
          .select("id")
          .eq("provider_ref", subscriptionCode)
          .maybeSingle();
        if (subRow) {
          await supabase.from("subscriptions").update({ status: "past_due" }).eq("id", subRow.id);
          await markProcessed({ subscription_id: subRow.id });
          break;
        }
        const { data: addOnRow } = await supabase
          .from("subscription_add_ons")
          .select("id")
          .eq("provider_ref", subscriptionCode)
          .maybeSingle();
        if (addOnRow) {
          await supabase.from("subscription_add_ons").update({ status: "past_due" }).eq("id", addOnRow.id);
          await markProcessed({ subscription_add_on_id: addOnRow.id });
          break;
        }
        await markFailed(`no row with provider_ref=${subscriptionCode}`);
        break;
      }

      case "subscription.disable":
      case "subscription.not_renew": {
        // Auto-renewal has been turned off (by the patient via
        // cancelSubscription, or by Paystack after repeated payment failure).
        // We do NOT flip status to 'cancelled' here: the paid period is
        // non-refundable and must run to its end. Instead flag
        // cancel_at_period_end and leave the row active — has_feature_access
        // keeps access alive until current_period_end, and the daily
        // expire-cancelled-subscriptions sweeper settles the status once the
        // period elapses. (Paystack can fire subscription.disable immediately
        // on the disable API call, well before period end, so cancelling on
        // this event would wrongly cut access short.)
        const subscriptionCode = event.data.subscription_code;
        if (!subscriptionCode) {
          await markFailed(`${event.event} missing subscription_code`);
          break;
        }
        const requestedAt = new Date().toISOString();
        const { data: subRow } = await supabase
          .from("subscriptions")
          .select("id, cancelled_at")
          .eq("provider_ref", subscriptionCode)
          .maybeSingle();
        if (subRow) {
          await supabase
            .from("subscriptions")
            .update({ cancel_at_period_end: true, cancelled_at: subRow.cancelled_at ?? requestedAt })
            .eq("id", subRow.id);
          await markProcessed({ subscription_id: subRow.id });
          break;
        }
        const { data: addOnRow } = await supabase
          .from("subscription_add_ons")
          .select("id, cancelled_at")
          .eq("provider_ref", subscriptionCode)
          .maybeSingle();
        if (addOnRow) {
          await supabase
            .from("subscription_add_ons")
            .update({ cancel_at_period_end: true, cancelled_at: addOnRow.cancelled_at ?? requestedAt })
            .eq("id", addOnRow.id);
          await markProcessed({ subscription_add_on_id: addOnRow.id });
          break;
        }
        await markFailed(`no row with provider_ref=${subscriptionCode}`);
        break;
      }

      case "charge.dispute.create": {
        // §91.17 fraud detection. A dispute is always worth a human look
        // regardless of whether it correlates to a known transaction — a
        // best-effort reference match (Paystack's dispute payload nests the
        // original charge under `transaction`) links it when possible, but
        // an unmatched dispute is still recorded, never dropped.
        const disputeRef = event.data.transaction?.reference ?? null;
        let matchedTxnId: string | null = null;
        if (disputeRef) {
          const { data: matched } = await supabase
            .from("payment_transactions")
            .select("id")
            .eq("provider", "paystack")
            .eq("provider_event_id", disputeRef)
            .maybeSingle();
          matchedTxnId = matched?.id ?? null;
        }
        await supabase.from("payment_fraud_signals").insert({
          signal_type: "chargeback",
          severity: "high",
          dedupe_key: `chargeback:paystack:${providerEventId}`,
          payment_transaction_id: matchedTxnId,
          amount_minor: event.data?.amount ?? null,
          currency: (event.data?.currency as "NGN" | "GBP" | "USD" | undefined) ?? null,
          detail: { provider: "paystack", provider_event_id: providerEventId, transaction_reference: disputeRef },
        });
        await markProcessed();
        break;
      }

      case "refund.pending":
      case "refund.failed": {
        // Recorded for audit, deliberately NOT marked processed.
        // private.finance_post_from_payment posts a Dr 4900 / Cr 1020
        // reversal for any event_type matching '%refund%' the moment
        // processed_at is set, and only a refund that actually completed has
        // left the bank account. A pending or failed one must not move the
        // ledger. `refund.processed` follows for the ones that do complete.
        break;
      }

      case "refund.processed": {
        // The money really has gone back to the patient. Correlate to the
        // original charge only to carry its organisation_id onto the
        // reversal (the journal lines are scoped by it), then mark processed
        // — which is what fires finance_post_payment_processed and, through
        // it, the Dr 4900 Refunds / Cr 1020 Cash entry that had been
        // unreachable for the whole life of this platform.
        //
        // If the refund was issued by one of the refund crons
        // (api/cron/{video-visit,pharmacy-order,voucher-cancellation}-refunds)
        // that cron has already recorded the same `refund:<id>` row and
        // posted the reversal; the unique (provider, provider_event_id)
        // index means this event replayed harmlessly above and never
        // reaches here. Either route posts exactly once.
        const chargeRef = event.data.transaction_reference ??
          event.data.transaction?.reference ??
          event.data.reference ??
          null;
        let organisationId: string | null = null;
        if (chargeRef) {
          const { data: original } = await supabase
            .from("payment_transactions")
            .select("organisation_id")
            .eq("provider", "paystack")
            .eq("provider_event_id", chargeRef)
            .maybeSingle();
          organisationId = original?.organisation_id ?? null;
        }
        await markProcessed(organisationId ? { organisation_id: organisationId } : {});
        break;
      }

      default:
        // Every other event type (invoice.create, etc.) is still recorded
        // above for audit but requires no state change.
        await markProcessed();
        break;
    }
  } catch (error) {
    console.error("paystack-webhook: unhandled processing error", error);
    await markFailed(error instanceof Error ? error.message : "unknown processing error");
  }

  return Response.json({ ok: true });
});
