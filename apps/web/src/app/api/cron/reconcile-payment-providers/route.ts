import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { runReconciliationSweep } from "@/lib/finance/reconciliation-sweep";
import { sweepStaleServicePurchases } from "@/lib/finance/service-purchase-expiry";
import { alertAdminsOfOpenFlags } from "@/lib/finance/reconciliation-flags";

/**
 * Daily automated Paystack reconciliation (Vercel Cron, see
 * apps/web/vercel.json). Three passes, in order:
 *
 *   1. runReconciliationSweep — compares Paystack's own record of the last
 *      48 hours against payment_transactions and flags any discrepancy.
 *      Detection only, never auto-remediation: it never touches
 *      payment_transactions, the ledger, or a subscription's state. The
 *      financial/compliance stakes of an automated write being wrong here are
 *      higher than the cost of a human looking at a flag — see the sweep's
 *      own header, and payment_reconciliation_flags' migration
 *      (20260812023750) for the schema/RLS design.
 *
 *   2. sweepStaleServicePurchases — added 2026-09-05. A service_purchases row
 *      whose webhook never landed used to sit at 'pending_payment' forever;
 *      pharmacy_orders has had a 24h expiry pass for this since it was built
 *      and service_purchases never did. Cancels an abandoned checkout, and —
 *      the self-heal half — asks Paystack before it does, so a purchase that
 *      WAS paid for is flagged for a webhook replay instead of being
 *      cancelled out from under the patient.
 *
 *   3. alertAdminsOfOpenFlags — added 2026-09-05. Flags used to be written
 *      and then read by nobody; the whole safety net ended in a table with no
 *      reader on any schedule. Now every admin gets one in_app notification a
 *      day for as long as something is open.
 *
 * Missing Paystack credentials are not an error. runReconciliationSweep()
 * returns empty, and sweepStaleServicePurchases() still cancels a checkout
 * that never reached the provider at all while leaving anything it cannot
 * ask about alone — an environment with no keys must not guess that a
 * reference it cannot verify was unpaid.
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
  const totals = await runReconciliationSweep(supabase);
  const stalePurchases = await sweepStaleServicePurchases(supabase);
  const alerted = await alertAdminsOfOpenFlags(supabase);

  return Response.json({ ...totals, stalePurchases, alerted });
}
