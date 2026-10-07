import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { refundTransaction } from "@/lib/paystack/refunds";
import { recordRefundLedgerEntry } from "@/lib/billing/refund-posting";

/**
 * Sweep for `refunds` rows in state `approved` — admin already approved via
 * `decide_order_refund`, but the Paystack refund API call hasn't happened yet.
 *
 * For each approved refund:
 * 1. Look up the successful payment for the order (payments table, status = 'success')
 * 2. Call Paystack's refund API
 * 3. On success: call `record_refund_provider_result` RPC (transitions state to
 *    'completed', sends the patient a notification) and post the GL reversal
 * 4. On failure: call `record_refund_provider_result` with p_success = false
 *    (transitions state to 'failed')
 *
 * Paystack only, same as every other refund cron on this platform.
 *
 * Verifies the Vercel-attached CRON_SECRET bearer, same as the other cron routes.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const supabase = createServiceRoleClient();

  // Fetch all approved refunds that haven't been sent to Paystack yet.
  const { data: approved } = await supabase
    .from("refunds")
    .select("id, order_id, amount_kobo, organisation_id")
    .eq("state", "approved")
    .eq("is_test", false);

  let processed = 0;
  let failed = 0;
  let skipped = 0;

  for (const refund of approved ?? []) {
    // Look up the successful payment for this order to get the Paystack reference.
    const { data: payment } = await supabase
      .from("payments")
      .select("provider, provider_reference")
      .eq("order_id", refund.order_id)
      .eq("status", "success")
      .limit(1)
      .maybeSingle();

    if (!payment || payment.provider !== "paystack") {
      skipped += 1;
      continue;
    }

    if (!isPaystackConfigured()) {
      skipped += 1;
      continue;
    }

    const result = await refundTransaction({
      reference: payment.provider_reference,
      amountKobo: refund.amount_kobo,
    });

    if (result.ok) {
      // Record success in the refunds state machine (approved → completed)
      // and send the patient a notification.
      await supabase.rpc("record_refund_provider_result", {
        p_refund: refund.id,
        p_success: true,
        p_reference: String(result.data.refundId),
        p_response: {},
      });

      // Post the GL reversal (Dr 4900 Refunds / Cr 1020 Cash).
      await recordRefundLedgerEntry(supabase, {
        refundId: String(result.data.refundId),
        chargeReference: payment.provider_reference,
        amountMinor: refund.amount_kobo,
        currency: "NGN",
        organisationId: refund.organisation_id,
        source: "order",
        sourceId: refund.order_id,
      });

      processed += 1;
    } else {
      // Record failure (approved → failed).
      await supabase.rpc("record_refund_provider_result", {
        p_refund: refund.id,
        p_success: false,
        p_reference: "",
        p_response: { error: result.error },
      });

      failed += 1;
    }
  }

  return Response.json({ processed, failed, skipped });
}
