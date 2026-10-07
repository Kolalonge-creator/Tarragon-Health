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
 * Idempotent: a patient never gets the same template twice in one Lagos day, so an overlapping or repeated run is safe.
 * Verifies the Vercel-attached CRON_SECRET bearer, like the other cron routes.
 */
const MAX_CONVERSATIONS_PER_RUN = 5000;
const CHUNK = 100;

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
  const startOfLagosDay = new Date(`${today}T00:00:00+01:00`).toISOString();
  const isSunday = lagosWeekday(now) === 0;
  const templates = isSunday ? ["assistant_daily_nudge", "assistant_weekly_reflection"] : ["assistant_daily_nudge"];

  const guardOn = await readAssistantGuardIsOn(svc);
  if (guardOn === null) return Response.json({ sent: 0, skipped: "guard_unreadable" }, { status: 503 });

  // Most recently active conversations first, so a cap never starves the patients who are actually using the assistant.
  const { data: convs, error: convError } = await svc
    .from("ai_conversations")
    .select("profile_id, organisation_id")
    .order("updated_at", { ascending: false })
    .limit(MAX_CONVERSATIONS_PER_RUN);
  if (convError) return Response.json({ sent: 0, error: "conversations_unreadable" }, { status: 500 });
  const orgOf = new Map<string, string>();
  for (const c of convs ?? []) if (c.profile_id && c.organisation_id && !orgOf.has(c.profile_id)) orgOf.set(c.profile_id, c.organisation_id);
  const ids = [...orgOf.keys()];
  if (ids.length === 0) return Response.json({ sent: 0 });

  let sent = 0;
  let failed = 0;
  for (const batch of chunks(ids, CHUNK)) {
    const { data: profiles, error: profileError } = await svc.from("profiles").select("id, role, is_active, is_test").in("id", batch);
    if (profileError) {
      failed += batch.length;
      continue;
    }
    const eligible = (profiles ?? []).filter((p) =>
      eligibleForAssistantNudge({ guardOpen: guardOn, role: p.role, isActive: p.is_active, isTest: p.is_test })
    );
    if (eligible.length === 0) continue;
    const { data: already } = await svc
      .from("notifications")
      .select("recipient_id, template")
      .in("recipient_id", eligible.map((p) => p.id))
      .in("template", templates)
      .gte("created_at", startOfLagosDay);
    const done = new Set((already ?? []).map((n) => `${n.recipient_id}:${n.template}`));
    const rows = eligible.flatMap((p) =>
      templates
        .filter((template) => !done.has(`${p.id}:${template}`))
        .map((template) => ({
          organisation_id: orgOf.get(p.id) as string,
          recipient_id: p.id,
          channel: "in_app" as const,
          status: "pending" as const,
          template,
          payload: { day: today },
        }))
    );
    if (rows.length === 0) continue;
    const { error } = await svc.from("notifications").insert(rows);
    if (error) failed += rows.length;
    else sent += rows.length;
  }
  return Response.json({ sent, failed });
}
