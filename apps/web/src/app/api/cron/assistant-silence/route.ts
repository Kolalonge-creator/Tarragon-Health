import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * S52 (7.10): once a day, for programme members who have gone quiet with the assistant, write an assistant.silence_detected event (a signal
 * the care team and the triage engine can read; it never changes treatment) and, after a longer quiet spell, queue ONE generic note ("It has
 * been a little while") at most once per cooldown. The thresholds are PROPOSED configuration (assistant_config key silence). Everything runs
 * in the database function public.assistant_detect_silence, which only touches people the assistant is open to (the go-live guard, or an
 * is_test account). A failed run returns 500 so it is seen. Verifies the Vercel-attached CRON_SECRET bearer.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }
  const svc = createServiceRoleClient() as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
  const { data, error } = await svc.rpc("assistant_detect_silence", {});
  if (error) return Response.json({ error: "silence_job_failed" }, { status: 500 });
  return Response.json(data ?? {});
}
