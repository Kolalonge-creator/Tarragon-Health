import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

/** Removes a push subscription — either a Web Push subscription (browser
 * disables notification permission) or an Expo push token (apps/mobile
 * sign-out). RLS-scoped: push_subscriptions_delete already restricts to
 * profile_id = auth.uid(). */

const bodySchema = z.union([
  z.object({ endpoint: z.string().url().max(2048) }),
  z.object({ expo_push_token: z.string().min(1).max(512) }),
]);

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
  const query = supabase.from("push_subscriptions").delete();
  const { error } =
    "expo_push_token" in parsed.data
      ? await query.eq("expo_push_token", parsed.data.expo_push_token)
      : await query.eq("endpoint", parsed.data.endpoint);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 200 });
  }
  return NextResponse.json({ ok: true });
}
