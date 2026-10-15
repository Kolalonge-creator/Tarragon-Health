import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { lagosDay, lagosWeekday } from "@/lib/ai-coach/nudges";
import { readAssistantGuardIsOn } from "@/lib/ai-coach/guard";

/**
 * S51 (7.5): once a day, one generic in-app notification per patient who recently used the assistant ("Your check-in for today is ready"),
 * and on Sundays (Lagos) one for the weekly reflection. The notification NAMES NOTHING (INV-07, keyed generic templates
 * assistant_daily_nudge and assistant_weekly_reflection); the nudge itself is built from the patient's own data when they open the app
 * (nudges.ts). Nothing here is required for any feature to work: if a send fails the patient simply sees the nudge when they open the app.
 *
 * WHO is decided in the database by public.assistant_nudge_candidates(): a conversation in the last `recent_days`, a real patient (an
 * is_test account is never nudged), the assistant on their plan, not opted out of wellness messages, the guard on, most recent first and
 * never more than `max_per_run` (assistant_config key nudges, PROPOSED, no built-in fallback).
 * Idempotent in the DATABASE, not in this code: public.assistant_queue_nudge inserts under a unique index on (patient, template, Lagos day),
 * so an overlapping or retried run cannot double-send.
 * A run that failed for any patient returns 500, so a broken run is seen. Verifies the Vercel-attached CRON_SECRET bearer.
 */
const PARALLEL = 20;

type Rpc = { rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const svc = createServiceRoleClient();
  const now = new Date();
  const today = lagosDay(now);
  const isSunday = lagosWeekday(now) === 0;
  const templates = isSunday ? ["assistant_daily_nudge", "assistant_weekly_reflection"] : ["assistant_daily_nudge"];

  const guardOn = await readAssistantGuardIsOn(svc);
  if (guardOn === null) return Response.json({ sent: 0, skipped: "guard_unreadable" }, { status: 503 });
  if (!guardOn) return Response.json({ sent: 0, skipped: "guard_off" });

  const rpc = (svc as unknown as Rpc).rpc.bind(svc);
  const { data: candidates, error: candidateError } = await rpc("assistant_nudge_candidates");
  if (candidateError) return Response.json({ sent: 0, error: "candidates_unreadable" }, { status: 500 });
  const ids = ((candidates as { patient_id: string }[] | null) ?? []).map((c) => c.patient_id);
  if (ids.length === 0) return Response.json({ sent: 0 });

  let sent = 0;
  let failed = 0;
  const jobs = ids.flatMap((patient) => templates.map((template) => ({ patient, template })));
  for (const group of chunks(jobs, PARALLEL)) {
    const results = await Promise.all(
      group.map((j) =>
        rpc("assistant_queue_nudge", { p_patient: j.patient, p_template: j.template, p_day: today }).then(
          (r) => (r.error ? ("failed" as const) : r.data === true ? ("sent" as const) : ("skipped" as const)),
          () => "failed" as const
        )
      )
    );
    for (const r of results) {
      if (r === "sent") sent += 1;
      else if (r === "failed") failed += 1;
    }
  }
  return Response.json({ sent, failed }, { status: failed > 0 ? 500 : 200 });
}
