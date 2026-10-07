import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * S52 (7.13): on the first of each month (Lagos), draw last month's review sample: every conversation a patient reported plus a random
 * sample (assistant_config key review, PROPOSED). The sample holds ids only; the Chief Medical Officer opens a conversation through the
 * audited reviewer screen. Idempotent: a conversation is sampled once per month. A failed run returns 500 so it is seen.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }
  const svc = createServiceRoleClient() as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
  const { data, error } = await svc.rpc("assistant_sample_month", {});
  if (error) return Response.json({ error: "sample_job_failed" }, { status: 500 });
  return Response.json(data ?? {});
}
