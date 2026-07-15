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
type BookingOrderType = "lab" | "pharmacy" | "referral";

interface CheckoutMetadata {
  kind?: CheckoutKind;
  profile_id?: string;
  item_code?: string;
  subscription_id?: string;
  booking_order_id?: string;
  booking_order_type?: BookingOrderType;
}

const BOOKING_TABLE: Record<BookingOrderType, "lab_orders" | "pharmacy_orders" | "specialist_referrals"> = {
  lab: "lab_orders",
  pharmacy: "pharmacy_orders",
  referral: "specialist_referrals",
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
    subscription?: { subscription_code?: string } | null;
    customer?: { email?: string } | null;
    next_payment_date?: string;
    id?: number | string;
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

  const providerEventId =
    event.data?.reference ??
    (event.data?.id !== undefined ? String(event.data.id) : null) ??
    event.data?.subscription_code ??
    `${event.event}:${rawBody.length}`;

  // Idempotency: a replayed webhook (Paystack retries, or a manual resend
  // from their dashboard) is a guaranteed no-op — the unique constraint on
  // (provider, provider_event_id) makes this insert fail silently via
  // on_conflict, and no row means "already handled, stop here."
  const { data: txnRow, error: insertError } = await supabase
    .from("payment_transactions")
    .insert({
      provider: "paystack",
      provider_event_id: providerEventId,
      event_type: (event.event as string) ?? "other",
      amount_minor: event.data?.amount ?? null,
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
            await markFailed(`no subscription_add_ons row with pending_provider_ref=${event.data.reference}`);
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
        const subscriptionCode = event.data.subscription_code;
        if (!subscriptionCode) {
          await markFailed(`${event.event} missing subscription_code`);
          break;
        }
        const cancelledAt = new Date().toISOString();
        const { data: subRow } = await supabase
          .from("subscriptions")
          .select("id")
          .eq("provider_ref", subscriptionCode)
          .maybeSingle();
        if (subRow) {
          await supabase
            .from("subscriptions")
            .update({ status: "cancelled", cancelled_at: cancelledAt })
            .eq("id", subRow.id);
          await markProcessed({ subscription_id: subRow.id });
          break;
        }
        const { data: addOnRow } = await supabase
          .from("subscription_add_ons")
          .select("id")
          .eq("provider_ref", subscriptionCode)
          .maybeSingle();
        if (addOnRow) {
          await supabase
            .from("subscription_add_ons")
            .update({ status: "cancelled", cancelled_at: cancelledAt })
            .eq("id", addOnRow.id);
          await markProcessed({ subscription_add_on_id: addOnRow.id });
          break;
        }
        await markFailed(`no row with provider_ref=${subscriptionCode}`);
        break;
      }

      default:
        // Every other event type (invoice.create, invoice.update, etc.) is
        // still recorded above for audit but requires no state change.
        await markProcessed();
        break;
    }
  } catch (error) {
    console.error("paystack-webhook: unhandled processing error", error);
    await markFailed(error instanceof Error ? error.message : "unknown processing error");
  }

  return Response.json({ ok: true });
});
