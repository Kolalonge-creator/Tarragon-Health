// Tarragon Health — Stripe webhook (diaspora GBP/USD billing)
//
// Authoritative source of truth for subscription/add-on activation — never
// the browser redirect back from Stripe's hosted checkout (see
// checkout-callback/page.tsx, which only does a same-request UX check).
// Mirrors supabase/functions/paystack-webhook/index.ts's shape: signature-
// verified, never throws past its boundary, always returns 200 (Stripe
// retries on non-2xx), and every event is recorded to payment_transactions,
// including ones it fails to process, so nothing is ever silently dropped.
//
// Correlation notes:
//   - `checkout.session.completed` carries back the `metadata` set at
//     Checkout Session creation time and `session.id`, which matches the
//     `pending_provider_ref` written on our row at checkout-initiate time.
//     This is what activates a row (status -> 'active') and sets
//     `provider_ref` to `session.subscription` (the Stripe subscription id)
//     — kept deliberately minimal, no current_period_end here.
//   - `customer.subscription.created` (fired ~simultaneously by Stripe for a
//     Checkout-created subscription) supplies current_period_end. Unlike
//     Paystack's fuzzy plan-code heuristic, this correlates by
//     `provider_ref = subscription.id` directly, since provider_ref was just
//     set synchronously above — a real foreign key, not a guess. Stripe
//     doesn't guarantee event ordering though, so if this arrives before
//     checkout.session.completed there's nothing to match yet; the row
//     still activates via checkout.session.completed and gets its period
//     end filled in later by customer.subscription.updated or
//     invoice.payment_succeeded.
//   - IMPORTANT: current_period_end lives at `subscription.items.data[0]
//     .current_period_end`, NOT `subscription.current_period_end` — Stripe's
//     Basil API version (2025-03-31+, which this project's pinned
//     STRIPE_API_VERSION postdates) moved billing periods to the
//     subscription-item level. Reading the old top-level field silently
//     returns undefined.
//   - `invoice.payment_succeeded` is Stripe's renewal-charge equivalent
//     (Stripe does not re-fire checkout.session.completed on renewal the way
//     Paystack re-fires charge.success). The subscription id similarly moved
//     under Basil to `invoice.parent.subscription_details.subscription`
//     (falling back to the deprecated `invoice.subscription` for safety).
//   - `customer.subscription.updated` with `cancel_at_period_end === true`
//     is treated as the mirror of Paystack's `subscription.not_renew`:
//     status flips to 'cancelled' immediately, matching the existing
//     precedent that DB status can go 'cancelled' before the paid period
//     actually ends (access-gating elsewhere already tolerates this for
//     Paystack rows).

import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@22.3.1?target=denonext";

const STRIPE_API_VERSION = "2026-06-24.dahlia";

function intervalEndFromSubscriptionItem(subscription: {
  items?: { data?: Array<{ current_period_end?: number }> };
}): string | null {
  const seconds = subscription.items?.data?.[0]?.current_period_end;
  return typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : null;
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
  const signatureHeader = req.headers.get("stripe-signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");

  // Fail closed, same as paystack-webhook: a forged event here activates a
  // real subscription/add-on for free, not just a fake chat message.
  if (!webhookSecret || !stripeSecretKey) {
    console.error("stripe-webhook: STRIPE_WEBHOOK_SECRET or STRIPE_SECRET_KEY is not set — rejecting all events");
    return Response.json({ ok: false, error: "not_configured" }, { status: 200 });
  }
  if (!signatureHeader) {
    return Response.json({ ok: false, error: "missing_signature" }, { status: 200 });
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: STRIPE_API_VERSION, httpClient: Stripe.createFetchHttpClient() });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signatureHeader,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (error) {
    console.error("stripe-webhook: signature verification failed", error);
    return Response.json({ ok: false, error: "invalid_signature" }, { status: 200 });
  }

  // Idempotency: a replayed webhook (Stripe retries, or a manual resend from
  // the dashboard) is a guaranteed no-op — the unique constraint on
  // (provider, provider_event_id) makes this insert fail silently via
  // on_conflict, and no row means "already handled, stop here." Stripe's
  // event.id is always present and stable (unlike Paystack's fallback chain
  // of reference/id/subscription_code).
  const { data: txnRow, error: insertError } = await supabase
    .from("payment_transactions")
    .insert({
      provider: "stripe",
      provider_event_id: event.id,
      event_type: (event.type as string) ?? "other",
      raw_payload: event as unknown as Record<string, unknown>,
    })
    .select("id")
    .maybeSingle();

  if (insertError && insertError.code !== "23505") {
    console.error("stripe-webhook: failed to record event", insertError);
    return Response.json({ ok: false, error: "record_failed" }, { status: 200 });
  }
  if (!txnRow) {
    return Response.json({ ok: true, replay: true });
  }

  const markProcessed = (patch: Record<string, unknown> = {}) =>
    supabase.from("payment_transactions").update({ processed_at: new Date().toISOString(), ...patch }).eq("id", txnRow.id);
  const markFailed = (error: string) =>
    supabase.from("payment_transactions").update({ error }).eq("id", txnRow.id);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const metadata = session.metadata as
          | {
              kind?: string;
              profile_id?: string;
              item_code?: string;
              booking_order_id?: string;
              booking_order_type?: "lab" | "pharmacy" | "referral";
            }
          | null;

        if (metadata?.kind === "booking") {
          // Payment-mode sessions never create a Stripe Subscription object,
          // so — unlike the subscription/add_on branch below — there is no
          // subscriptionId to require here; activation is one-shot on this
          // single event.
          const bookingOrderType = metadata.booking_order_type;
          if (!bookingOrderType) {
            await markFailed("booking checkout.session.completed missing metadata.booking_order_type");
            break;
          }
          const bookingTable =
            bookingOrderType === "lab"
              ? "lab_orders"
              : bookingOrderType === "pharmacy"
                ? "pharmacy_orders"
                : "specialist_referrals";

          const { data: bookingRow } = await supabase
            .from(bookingTable)
            .select("id, organisation_id")
            .eq("pending_payment_provider_ref", session.id)
            .maybeSingle();

          if (!bookingRow) {
            await markFailed(`no ${bookingTable} row with pending_payment_provider_ref=${session.id}`);
            break;
          }

          await supabase
            .from(bookingTable)
            .update({
              status: "payment_confirmed",
              payment_provider: "stripe",
              payment_provider_ref: session.id,
              pending_payment_provider_ref: null,
            })
            .eq("id", bookingRow.id);

          await markProcessed({
            organisation_id: bookingRow.organisation_id,
            booking_order_id: bookingRow.id,
            booking_order_type: bookingOrderType,
          });
          break;
        }

        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : session.subscription?.id;

        if (!metadata?.kind || !subscriptionId) {
          await markFailed("checkout.session.completed missing metadata.kind or subscription id");
          break;
        }

        const table = metadata.kind === "subscription" ? "subscriptions" : "subscription_add_ons";
        const { data: row } = await supabase
          .from(table)
          .select("id, organisation_id")
          .eq("pending_provider_ref", session.id)
          .maybeSingle();

        if (!row) {
          await markFailed(`no ${table} row with pending_provider_ref=${session.id}`);
          break;
        }

        await supabase
          .from(table)
          .update({
            status: "active",
            provider: "stripe",
            provider_ref: subscriptionId,
            pending_provider_ref: null,
          })
          .eq("id", row.id);

        await markProcessed(
          metadata.kind === "subscription"
            ? { organisation_id: row.organisation_id, subscription_id: row.id }
            : { organisation_id: row.organisation_id, subscription_add_on_id: row.id },
        );
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const periodEnd = intervalEndFromSubscriptionItem(subscription);

        const { data: subRow } = await supabase
          .from("subscriptions")
          .select("id")
          .eq("provider_ref", subscription.id)
          .maybeSingle();

        if (subRow) {
          const patch: Record<string, unknown> = {};
          if (periodEnd) patch.current_period_end = periodEnd;
          if (subscription.cancel_at_period_end) {
            patch.status = "cancelled";
            patch.cancelled_at = new Date().toISOString();
          }
          if (Object.keys(patch).length > 0) {
            await supabase.from("subscriptions").update(patch).eq("id", subRow.id);
          }
          await markProcessed({ subscription_id: subRow.id });
          break;
        }

        const { data: addOnRow } = await supabase
          .from("subscription_add_ons")
          .select("id")
          .eq("provider_ref", subscription.id)
          .maybeSingle();

        if (addOnRow) {
          const patch: Record<string, unknown> = {};
          if (periodEnd) patch.current_period_end = periodEnd;
          if (subscription.cancel_at_period_end) {
            patch.status = "cancelled";
            patch.cancelled_at = new Date().toISOString();
          }
          if (Object.keys(patch).length > 0) {
            await supabase.from("subscription_add_ons").update(patch).eq("id", addOnRow.id);
          }
          await markProcessed({ subscription_add_on_id: addOnRow.id });
          break;
        }

        // Not necessarily an error — this event can arrive before
        // checkout.session.completed has set provider_ref yet (Stripe does
        // not guarantee delivery order). The row still activates via
        // checkout.session.completed; it just misses this period-end update.
        await markFailed(`no row with provider_ref=${subscription.id} (yet)`);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const cancelledAt = new Date().toISOString();

        const { data: subRow } = await supabase
          .from("subscriptions")
          .select("id, status")
          .eq("provider_ref", subscription.id)
          .maybeSingle();
        if (subRow) {
          if (subRow.status !== "cancelled") {
            await supabase
              .from("subscriptions")
              .update({ status: "cancelled", cancelled_at: cancelledAt })
              .eq("id", subRow.id);
          }
          await markProcessed({ subscription_id: subRow.id });
          break;
        }

        const { data: addOnRow } = await supabase
          .from("subscription_add_ons")
          .select("id, status")
          .eq("provider_ref", subscription.id)
          .maybeSingle();
        if (addOnRow) {
          if (addOnRow.status !== "cancelled") {
            await supabase
              .from("subscription_add_ons")
              .update({ status: "cancelled", cancelled_at: cancelledAt })
              .eq("id", addOnRow.id);
          }
          await markProcessed({ subscription_add_on_id: addOnRow.id });
          break;
        }

        await markFailed(`no row with provider_ref=${subscription.id}`);
        break;
      }

      case "invoice.payment_succeeded":
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice & {
          parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
          subscription?: string | { id: string } | null;
        };
        const parentSub = invoice.parent?.subscription_details?.subscription;
        const rawSubscriptionId = parentSub ?? invoice.subscription ?? null;
        const subscriptionId =
          typeof rawSubscriptionId === "string" ? rawSubscriptionId : rawSubscriptionId?.id;

        if (!subscriptionId) {
          await markFailed(`${event.type} missing subscription id`);
          break;
        }

        const newStatus = event.type === "invoice.payment_succeeded" ? "active" : "past_due";
        // invoice.lines carries per-line-item period boundaries independent
        // of the Basil subscription-object change — no follow-up API call
        // needed to refresh current_period_end on a renewal.
        const lineEndSeconds = invoice.lines?.data?.[0]?.period?.end;
        const periodEnd = typeof lineEndSeconds === "number" ? new Date(lineEndSeconds * 1000).toISOString() : null;

        const { data: subRow } = await supabase
          .from("subscriptions")
          .select("id")
          .eq("provider_ref", subscriptionId)
          .maybeSingle();
        if (subRow) {
          const patch: Record<string, unknown> = { status: newStatus };
          if (periodEnd) patch.current_period_end = periodEnd;
          await supabase.from("subscriptions").update(patch).eq("id", subRow.id);
          await markProcessed({ subscription_id: subRow.id });
          break;
        }

        const { data: addOnRow } = await supabase
          .from("subscription_add_ons")
          .select("id")
          .eq("provider_ref", subscriptionId)
          .maybeSingle();
        if (addOnRow) {
          const patch: Record<string, unknown> = { status: newStatus };
          if (periodEnd) patch.current_period_end = periodEnd;
          await supabase.from("subscription_add_ons").update(patch).eq("id", addOnRow.id);
          await markProcessed({ subscription_add_on_id: addOnRow.id });
          break;
        }

        await markFailed(`no row with provider_ref=${subscriptionId}`);
        break;
      }

      default:
        // Every other event type is still recorded above for audit but
        // requires no state change.
        await markProcessed();
        break;
    }
  } catch (error) {
    console.error("stripe-webhook: unhandled processing error", error);
    await markFailed(error instanceof Error ? error.message : "unknown processing error");
  }

  return Response.json({ ok: true });
});
