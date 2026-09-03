import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { runClinicalRulesWorker } from "@/lib/clinical-rules/worker";

/**
 * Drains the Clinical Rules & Care Protocol Engine's event queue (spec §32,
 * see supabase/migrations/20260829093257+ and
 * apps/web/src/lib/clinical-rules/). Every clinical event emitter (part 4 of
 * the migration set) only enqueues a row on clinical_rule_events; this cron
 * is what actually evaluates it. Scheduled daily (apps/web/vercel.json),
 * matching every other cron route in this project, since every rule the
 * catalogue currently ships runs in SHADOW mode -- nothing patient-visible
 * depends on this queue draining quickly yet. Once a rule is signed active
 * and its actions matter promptly, tighten this schedule (confirm the
 * project's Vercel plan supports sub-daily cron invocations first — Vercel
 * Hobby historically restricts crons to once per day). Verifies the
 * Vercel-attached `Authorization: Bearer <CRON_SECRET>` header, same as the
 * other cron routes (see api/cron/wearable-sync/route.ts).
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const summary = await runClinicalRulesWorker(supabase);
  return Response.json(summary);
}
