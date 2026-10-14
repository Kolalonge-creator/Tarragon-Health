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

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

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
