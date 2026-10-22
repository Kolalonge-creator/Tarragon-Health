import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Queue entitlement expiry reminders at 30, 7 and 1 day before the end (S26b).
 *
 * The work is one database call, `service_run_entitlement_reminders`, because the step list, the claim (one row per entitlement and
 * step, so a step sends once however often this runs) and the channel choice (`private.patient_reminder_channel()`: email if preferred,
 * else push if subscribed, else the in-app inbox) all live in the database. This route used to claim and notify itself with a hard-coded
 * in-app channel; that path is gone. A reminder only notifies, it never renews or charges (safety case 25).
 *
 * Verifies the Vercel-attached CRON_SECRET bearer, same as the other cron routes.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("service_run_entitlement_reminders");
  if (error) {
    // 500 so the run shows as failed in Vercel; the next run retries every step that has no row yet.
    return Response.json({ error: "reminders_failed" }, { status: 500 });
  }
  return Response.json({ reminded: typeof data === "number" ? data : 0 });
}
