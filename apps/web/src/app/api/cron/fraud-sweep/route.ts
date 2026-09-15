import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { runFraudSweep } from "@/lib/finance/fraud-sweep";

/**
 * §91.17 fraud detection sweep — detection only, no automated account
 * action (finance reviews flagged signals manually on /finance/fraud,
 * matching the reconciliation sweep's own "detect and flag, don't
 * auto-remediate" posture). Verifies the Vercel-attached CRON_SECRET
 * bearer, same as every other cron route.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const totals = await runFraudSweep(supabase);
  return Response.json(totals);
}
