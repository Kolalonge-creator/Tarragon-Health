import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { lagosDay, lagosWeekday } from "@/lib/ai-coach/nudges";
import { eligibleForAssistantNudge } from "@/lib/ai-coach/nudge-recipients";
import { readAssistantGuardIsOn } from "@/lib/ai-coach/guard";

/**
 * S51 (7.5): once a day, one generic in-app notification per patient who already uses the assistant ("Your check-in for today is ready"),
 * and on Sundays (Lagos) one for the weekly reflection. The notification NAMES NOTHING (INV-07, keyed generic templates
 * assistant_daily_nudge and assistant_weekly_reflection); the nudge itself is built from the patient's own data when they open the app
 * (nudges.ts). Nothing here is required for any feature to work: if a send fails the patient simply sees the nudge when they open the app.
 *
 * Closed while the assistant_enabled guard is off, except for is_test patients (the same test rule the rest of the guard uses).
 * Idempotent in the DATABASE, not in this code: public.assistant_queue_nudge inserts under a unique index on (patient, template, Lagos day),
 * so an overlapping or retried run cannot double-send, and it skips a patient who switched every wellness channel off.
 * A run that failed for any patient returns 500, so a broken run is seen. Verifies the Vercel-attached CRON_SECRET bearer.
 */
const MAX_CONVERSATIONS_PER_RUN = 5000;
const CHUNK = 100;
const PARALLEL = 20;

type Queue = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };

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

  // Most recently active conversations first, so a cap never starves the patients who are actually using the assistant.
  const { data: convs, error: convError } = await svc
    .from("ai_conversations")
    .select("profile_id")
    .order("updated_at", { ascending: false })
    .limit(MAX_CONVERSATIONS_PER_RUN);
  if (convError) return Response.json({ sent: 0, error: "conversations_unreadable" }, { status: 500 });
  const ids = [...new Set((convs ?? []).map((c) => c.profile_id).filter((x): x is string => Boolean(x)))];
  if (ids.length === 0) return Response.json({ sent: 0 });

  let sent = 0;
  let failed = 0;
  for (const batch of chunks(ids, CHUNK)) {
    const { data: profiles, error: profileError } = await svc.from("profiles").select("id, role, is_active, is_test").in("id", batch);
    if (profileError) {
      failed += batch.length;
      continue;
    }
    const jobs = (profiles ?? [])
      .filter((p) => eligibleForAssistantNudge({ guardOpen: guardOn, role: p.role, isActive: p.is_active, isTest: p.is_test }))
      .flatMap((p) => templates.map((template) => ({ patient: p.id, template })));
    for (const group of chunks(jobs, PARALLEL)) {
      const results = await Promise.all(
        group.map((j) =>
          (svc as unknown as Queue).rpc("assistant_queue_nudge", { p_patient: j.patient, p_template: j.template, p_day: today }).then(
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
  }
  return Response.json({ sent, failed }, { status: failed > 0 ? 500 : 200 });
}
