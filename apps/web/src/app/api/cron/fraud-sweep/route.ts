import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { runFraudSweep, alertAdminsOfOpenFraudSignals } from "@/lib/finance/fraud-sweep";

/**
 * §91.17 fraud detection sweep — detection only, no automated account
 * action (finance reviews flagged signals manually on /finance/fraud,
 * matching the reconciliation sweep's own "detect and flag, don't
 * auto-remediate" posture). Verifies the Vercel-attached CRON_SECRET
 * bearer, same as every other cron route.
 *
 * alertAdminsOfOpenFraudSignals — added 2026-09-18 (finance dashboard
 * audit). Signals used to be written and read by nobody: nothing paged an
 * admin, so a duplicate-charge or chargeback signal sat silent until someone
 * happened to open /finance/fraud. Mirrors the reconcile-payment-providers
 * cron's own alertAdminsOfOpenFlags call, one step after the sweep.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const totals = await runFraudSweep(supabase);
  const alerted = await alertAdminsOfOpenFraudSignals(supabase);
  return Response.json({ ...totals, alerted });
}
