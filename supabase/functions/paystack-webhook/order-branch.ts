// S25: the v5 catalogue-order branch of the Paystack webhook (docs/design/S25.md section 5).
//
// A `charge.success` whose metadata says `kind: "order"` belongs to the v5 order tables, not to the legacy payment_transactions
// path below it, so it is handled here and the legacy path (and every trigger hanging off payment_transactions) never sees it.
// The order is paid only after Paystack's own verify call agrees (the body of a webhook is a hint, never proof), and the
// database writer is idempotent on the reference (safety case 24), so a Paystack retry or a manual resend is harmless.
//
// Unlike the legacy path this branch does NOT always answer 200. A payment we failed to record must be retried by Paystack
// (every 3 minutes for 4 tries, then hourly for up to 72 hours), so a store or Paystack failure, a signature the adapter does not
// accept, or a charge Paystack still calls pending answers 500. The sweeper (order-reconcile) is the second net behind that.

import { handleOrderWebhook, supabaseOrderStore, type CommerceDeps, type RpcClient } from "../_shared/commerce/index.ts";
import { isValidChargeReference, paymentFromEnv, type PaymentProvider } from "../_shared/integrations/index.ts";

export type DepsFactory = (supabase: RpcClient) => CommerceDeps | null;

/** Real Paystack from the environment, or null when no key is configured. Never a mock (the adapter package's own rule). */
export const defaultDepsFactory: DepsFactory = (supabase) => {
  const env = { PAYSTACK_SECRET_KEY: Deno.env.get("PAYSTACK_SECRET_KEY"), PAYSTACK_WEBHOOK_SECRET: Deno.env.get("PAYSTACK_WEBHOOK_SECRET") };
  const payments: PaymentProvider | null = paymentFromEnv(env, (input, init) => fetch(input, init));
  return payments ? { payments, store: supabaseOrderStore(supabase) } : null;
};

/** True when this (already signature-checked) event is for a v5 order. */
export function isOrderCharge(event: { event?: string; data?: { metadata?: { kind?: string } | null } }): boolean {
  return event.event === "charge.success" && event.data?.metadata?.kind === "order";
}

export async function handleOrderCharge(rawBody: string, signature: string | null, supabase: RpcClient, factory: DepsFactory = defaultDepsFactory): Promise<Response> {
  const deps = factory(supabase);
  if (!deps) {
    console.error("paystack-webhook: an order payment arrived but PAYSTACK_SECRET_KEY is not configured");
    return Response.json({ ok: false, error: "payments_not_configured" }, { status: 500 });
  }
  // The outer handler already verified the signature and parsed the JSON, so hand over the reference and the adapter's own
  // idempotency key shape (`charge.success:<reference>`) rather than verifying the same body a second time.
  let preVerified: { reference: string; key: string } | undefined;
  try {
    const ref: unknown = JSON.parse(rawBody)?.data?.reference;
    if (typeof ref === "string" && isValidChargeReference(ref)) preVerified = { reference: ref, key: `charge.success:${ref}` };
  } catch { /* unparseable here means the adapter path below decides */ }
  const out = await handleOrderWebhook(deps, rawBody, signature, preVerified);
  if (!out.handled) {
    // The handler already verified the signature with PAYSTACK_WEBHOOK_SECRET; the adapter disagreeing means the two secrets differ.
    console.error("paystack-webhook: order webhook not accepted by the payment adapter", out.reason);
    return Response.json({ ok: false, error: out.reason }, { status: 500 });
  }
  const c = out.confirm;
  if (c.outcome === "retry" || c.outcome === "pending") {
    console.error("paystack-webhook: order payment not settled yet, asking Paystack to retry", c.outcome);
    return Response.json({ ok: false, error: c.outcome }, { status: 500 });
  }
  if (c.outcome === "not_found") {
    // Paystack says this charge succeeded but no order of ours has that reference: money with no order. Never ack it quietly:
    // 500 makes Paystack retry (and shows in the function logs and Sentry) until a person has looked.
    console.error("paystack-webhook: a verified order payment has no matching order, asking Paystack to retry");
    return Response.json({ ok: false, error: "order_not_found" }, { status: 500 });
  }
  if (c.outcome === "mismatch") console.error("paystack-webhook: order payment mismatch recorded, an incident is open", c.reason);
  return Response.json({ ok: true, order: c.outcome });
}
