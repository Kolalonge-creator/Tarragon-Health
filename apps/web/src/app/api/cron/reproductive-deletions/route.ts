import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Daily: carries out the cycle-data deletions whose waiting period has ended (S66, decision C). Same Vercel Cron bearer check as the
 * other cron routes. The database function does the work and writes the receipt (counts only) to the audit log; this route only calls it
 * and reports how many it completed. A failure is returned as a 500, never swallowed: a deletion the person asked for must not quietly not
 * happen.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("process_due_reproductive_tracker_deletions");
  if (error) return Response.json({ ok: false, error: "deletion run failed" }, { status: 500 });
  return Response.json({ ok: true, completed: data ?? 0 });
}
