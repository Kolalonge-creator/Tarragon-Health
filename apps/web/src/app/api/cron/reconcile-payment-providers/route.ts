import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { runReconciliationSweep } from "@/lib/finance/reconciliation-sweep";

/**
 * Daily automated Paystack/Stripe reconciliation (Vercel Cron, see
 * apps/web/vercel.json). Detection only, never auto-remediation: it writes
 * payment_reconciliation_flags rows for a human to review on
 * /finance/reconciliation, and never touches payment_transactions, the
 * ledger, or a subscription's state itself. The financial/compliance stakes
 * of an automated write being wrong here are higher than the cost of a
 * human looking at a flag — see the reconciliation sweep's own header for
 * the full reasoning, and payment_reconciliation_flags' migration
 * (20260812023750) for the schema/RLS design.
 *
 * Missing provider credentials are not an error: runReconciliationSweep()
 * simply skips whichever provider isn't configured (matches
 * isPaystackConfigured()/isStripeConfigured() being false in a dev/staging
 * environment with no real keys, same as the checkout paths already do).
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

  return Response.json(totals);
}
