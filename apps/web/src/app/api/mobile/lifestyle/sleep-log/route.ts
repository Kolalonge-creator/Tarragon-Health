import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { logSleepEntrySchema } from "@/lib/validation/sleep";
import { flagAbnormalSleep } from "@/lib/sleep/escalate";

/**
 * Mobile equivalent of the patient sleep tracker's logSleepEntryAction.
 *
 * Routed through a server endpoint rather than written directly from the app,
 * for the same reason as lifestyle/log/route.ts next door: logging sleep is
 * not a plain insert. flagAbnormalSleep() runs afterwards and can raise a
 * clinical alert on a dangerously short night or severe daytime sleepiness. A
 * direct client insert from the native app would persist the row and silently
 * skip that check, which is the exact shape of bug this codebase keeps
 * relearning -- a second client drifting out of sync with a safety step that
 * only one of them runs.
 *
 * The other five lifestyle trackers (smoking, alcohol, activity, exercise,
 * nutrition) carry no such side effect and are plain RLS-guarded writes, so
 * they stay direct client writes on mobile and get no route here. If one of
 * them ever grows an escalation, it needs to move here too.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const accessToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) {
    return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Same Zod schema the web server action validates against, not a second
  // hand-written one.
  const parsed = logSleepEntrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: "No organisation on file" }, { status: 400 });
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
  const row = {
    duration_hours: parsed.data.duration_hours,
    quality_rating: parsed.data.quality_rating ?? null,
    bedtime: parsed.data.bedtime ?? null,
    waketime: parsed.data.waketime ?? null,
    daytime_sleepiness: parsed.data.daytime_sleepiness ?? null,
    note: parsed.data.note ?? null,
  };

  // Update-then-insert, matching the web action: one entry per Lagos day, and
  // re-logging corrects today's row rather than stacking a second one.
  const { data: updated, error: updateErr } = await supabase
    .from("sleep_log_entries")
    .update(row)
    .eq("patient_id", user.id)
    .eq("logged_on", today)
    .select("id");
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 400 });
  }

  if (!updated || updated.length === 0) {
    const { error: insertErr } = await supabase.from("sleep_log_entries").insert({
      organisation_id: profile.organisation_id,
      patient_id: user.id,
      logged_on: today,
      ...row,
    });
    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 400 });
    }
  }

  // Best-effort, exactly as on web: a failure here must never lose the
  // patient's own log, which is already saved above.
  await flagAbnormalSleep(user.id, profile.organisation_id, {
    duration_hours: row.duration_hours,
    daytime_sleepiness: row.daytime_sleepiness,
  }).catch(() => undefined);

  return NextResponse.json({ ok: true });
}
