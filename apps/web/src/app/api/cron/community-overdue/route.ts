import { isCronAuthorised } from "@/lib/cron-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Community overdue-work check. Safety items older than `overdue_safety_minutes` and queue items older than `overdue_queue_minutes`
 * (versioned configuration) tell the safety reviewers, the moderators and the Chief Medical Officer, once per ten minutes each.
 *
 * This needs to run about every ten minutes, round the clock. Vercel's cron on a small plan only runs daily, so it is driven by
 * .github/workflows/community-overdue.yml, which calls this route with the CRON_SECRET. It does nothing while the `community` guard is off
 * and there is nothing waiting.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!isCronAuthorised(authHeader)) return new Response("Not authorised", { status: 401 });
  const supabase = createServiceRoleClient();
  // Each run reports in, success or failure, so the go-live check can see that this safety net is really running.
  const heartbeat = (ok: boolean) => supabase.rpc("community_job_heartbeat", { p_job: "overdue", p_ok: ok });
  const work = await supabase.rpc("community_overdue_work");
  if (work.error) {
    await heartbeat(false);
    return Response.json({ error: "could not read overdue work" }, { status: 500 });
  }
  const notified = await supabase.rpc("community_notify_overdue");
  if (notified.error) {
    await heartbeat(false);
    return Response.json({ error: "could not send notices" }, { status: 500 });
  }
  await heartbeat(true);
  return Response.json({ work: work.data, notified: Number(notified.data ?? 0) });
}
