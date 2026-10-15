import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

/**
 * Called by the service worker's `push` handler (public/sw.js) the moment a page notification is actually put on the screen.
 * Web Push gives the sender no delivery receipt, so this is the delivered acknowledgement (S19c, decision 9): the database
 * uses it to decide whether the page was ever shown, and advances the ladder early when it was not. The RPC only records a
 * receipt for the signed-in recipient's own page notification; for any other id it returns false. Best effort and silent:
 * a failure here never stops the notification being shown.
 */
const bodySchema = z.object({ notificationId: z.uuid() });

/**
 * A light per-user limit (per server instance): a browser that fires this in a loop cannot turn it into database load. A real
 * clinician needs one call per page notification shown, so a few a second is generous.
 */
const WINDOW_MS = 10_000;
const MAX_PER_WINDOW = 10;
const recent = new Map<string, number[]>();

function limited(userId: string, now: number): boolean {
  const hits = (recent.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  recent.set(userId, hits);
  if (recent.size > 5000) for (const [k, v] of recent) if (v.every((t) => now - t >= WINDOW_MS)) recent.delete(k);
  return hits.length > MAX_PER_WINDOW;
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  if (limited(user.id, Date.now())) return NextResponse.json({ ok: false, error: "slow down" }, { status: 429 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc("record_notification_displayed", { p_notification: parsed.data.notificationId });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 200 });
  return NextResponse.json({ ok: true, recorded: data === true });
}
