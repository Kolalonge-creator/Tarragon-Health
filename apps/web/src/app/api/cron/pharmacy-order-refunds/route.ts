import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { refundTransaction } from "@/lib/paystack/refunds";

/**
 * Pharmacy order payment hygiene (Vercel Cron, see apps/web/vercel.json) —
 * Pharmacy Engine spec §12.9, built ahead of a real partner (see
 * docs/PHARMACY_ENGINE_SPEC.md). Mirrors video-visit-refunds' two-pass shape
 * for the same reason: an order that's paid for needs the same "expire the
 * abandoned ones, refund the declined ones" hygiene a held payment always
 * does, and there's no reason to invent a different pattern for it.
 *
 *   1. Expiry — a `pending_payment` order older than 24h never completed
 *      checkout; no charge was ever captured (payment_provider_ref is only
 *      ever set by the Paystack/Stripe webhook on success), so this is a
 *      plain cancellation, never a refund.
 *   2. Refunds — every order with refund_status='due' (a pharmacist's
 *      partial-fulfilment accept, or a decline — see
 *      pharmacist_accept_order/pharmacist_decline_order) gets refunded via
 *      the Paystack Refunds API for refund_amount_kobo (partial or full).
 *      Success flips refund_status to 'refunded'; failure leaves it 'due'
 *      to retry next run — nothing is ever silently dropped.
 *
 * Dormant in practice today: is_active is false for every real
 * pharmacy_partners row, so no real order can exist for this to act on until
 * a partner is actually contracted.
 *
 * Verifies the Vercel-attached CRON_SECRET bearer, same as the other cron
 * routes.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const expiryCutoff = new Date(Date.now() - 24 * 3600_000).toISOString();

  const { data: expired } = await supabase
    .from("pharmacy_orders")
    .update({ status: "cancelled", cancellation_reason: "Payment was not completed in time" })
    .eq("status", "pending_payment")
    .lt("created_at", expiryCutoff)
    .select("id");

  const { data: due } = await supabase
    .from("pharmacy_orders")
    .select("id, payment_provider, payment_provider_ref, refund_amount_kobo, payable_kobo, total_kobo")
    .eq("refund_status", "due");

  let refunded = 0;
  let manual = 0;
  let failed = 0;
  for (const row of due ?? []) {
    if (row.payment_provider !== "paystack" || !row.payment_provider_ref) {
      manual += 1;
      continue;
    }
    if (!isPaystackConfigured()) {
      failed += 1;
      continue;
    }
    const amountKobo = row.refund_amount_kobo ?? row.payable_kobo ?? row.total_kobo;
    const result = await refundTransaction({
      reference: row.payment_provider_ref,
      amountKobo: amountKobo ?? undefined,
    });
    if (result.ok) {
      await supabase
        .from("pharmacy_orders")
        .update({ refund_status: "refunded", refund_ref: String(result.data.refundId) })
        .eq("id", row.id);
      refunded += 1;
    } else {
      failed += 1;
    }
  }

  return Response.json({
    expired: (expired ?? []).length,
    refunded,
    refund_failures: failed,
    needs_manual_refund: manual,
  });
}
