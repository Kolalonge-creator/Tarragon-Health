import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

/**
 * Stores a Web Push subscription for the signed-in user's device. Called by
 * the push-subscribe client component the first time permission is granted
 * (and again silently if the browser ever rotates the subscription).
 *
 * RLS-scoped (not service-role) — push_subscriptions_insert already
 * requires profile_id = auth.uid(), so this can only ever create a
 * subscription for the caller's own account.
 */

const bodySchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
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
    return NextResponse.json({ ok: false, error: "invalid subscription" }, { status: 400 });
  }
  const { endpoint, keys } = parsed.data;

  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ ok: false, error: "no organisation on file" }, { status: 200 });
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      organisation_id: profile.organisation_id,
      profile_id: user.id,
      endpoint,
      p256dh_key: keys.p256dh,
      auth_key: keys.auth,
      user_agent: request.headers.get("user-agent") ?? null,
      last_seen_at: new Date().toISOString(),
      disabled_at: null,
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 200 });
  }
  return NextResponse.json({ ok: true });
}
