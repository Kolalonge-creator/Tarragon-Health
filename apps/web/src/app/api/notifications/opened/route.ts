import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

/**
 * Called by the service worker's `notificationclick` handler (public/sw.js)
 * the instant a push notification is actually opened. This is the real
 * delivery-confirmation signal the forced-channel escalation engine
 * (private.escalate_unconfirmed_critical_notifications) waits on — Web
 * Push itself has no delivery receipt, so `opened_at` is the only positive
 * confirmation a push-channel notification can ever produce.
 *
 * RLS-scoped: notifications_update already restricts to
 * recipient_id = auth.uid() (or org staff), so this can only ever mark the
 * caller's own notification.
 */

const bodySchema = z.object({
  notificationId: z.string().uuid(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("notifications")
    .update({ status: "read", opened_at: nowIso })
    .eq("id", parsed.data.notificationId)
    .eq("recipient_id", user.id)
    .is("opened_at", null);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 200 });
  }
  return NextResponse.json({ ok: true });
}
