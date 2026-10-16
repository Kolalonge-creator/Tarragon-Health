import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { refundTransaction } from "@/lib/paystack/refunds";
import { recordRefundLedgerEntry } from "@/lib/billing/refund-posting";
import { sendApprovedOrderRefund } from "@/lib/billing/order-refund-send";

/**
 * Sweep for `refunds` rows in state `approved`: an admin approved via `decide_order_refund`, but the Paystack refund call has not
 * happened yet. Each refund goes through claim -> send -> record (see `sendApprovedOrderRefund`), so a refund can never be sent twice
 * and a failed send is recorded and retried by an admin, never lost.
 *
 * Afterwards the reversal catch-up runs: any completed refund whose deferred-revenue release or clinician earnings reversal did not
 * finish is retried (and raises an ops incident while it keeps failing).
 *
 * Paystack only, same as every other refund cron on this platform. Verifies the Vercel-attached CRON_SECRET bearer.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: approved } = await supabase.from("refunds").select("id").eq("state", "approved").eq("is_test", false);

  const totals = { processed: 0, failed: 0, unknown: 0, skipped: 0 };
  if (isPaystackConfigured()) {
    for (const refund of approved ?? []) {
      const outcome = await sendApprovedOrderRefund({ supabase, refundTransaction, recordRefundLedgerEntry }, refund.id);
      totals[outcome] += 1;
    }
  } else {
    totals.skipped = approved?.length ?? 0;
  }

  const { data: caughtUp } = await supabase.rpc("service_run_refund_catch_up");
  return Response.json({ ...totals, caughtUp: typeof caughtUp === "number" ? caughtUp : 0 });
}
