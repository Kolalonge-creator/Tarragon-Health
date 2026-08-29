import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { runFraudDetectionSweep } from "@/lib/finance/fraud-sweep";

/**
 * Daily financial fraud sweep (Vercel Cron, see apps/web/vercel.json).
 * Detection only, never auto-remediation: it writes payment_fraud_signals
 * rows for a human to review on /finance/fraud, and never touches a
 * payment, a subscription, or the ledger itself — see fraud-sweep.ts's own
 * header and 20260829001257_payment_fraud_signals.sql for the full
 * reasoning, same posture as /api/cron/reconcile-payment-providers next to
 * it.
 *
 * Verifies the Vercel-attached CRON_SECRET bearer, same as every other cron
 * route in this codebase.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const totals = await runFraudDetectionSweep(supabase);

  return Response.json(totals);
}
