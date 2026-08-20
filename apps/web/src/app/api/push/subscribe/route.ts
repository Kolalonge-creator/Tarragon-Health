import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

/**
 * Stores a push subscription for the signed-in user's device — either a Web
 * Push subscription (browser) or an Expo push token (apps/mobile, iOS/Android).
 * Called by the web push-subscribe client component on first permission grant
 * (and silently on rotation), or by apps/mobile/src/lib/push-notifications.ts
 * right after login.
 *
 * RLS-scoped (not service-role) — push_subscriptions_insert already
 * requires profile_id = auth.uid(), so this can only ever create a
 * subscription for the caller's own account.
 */

const webBodySchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
});

const nativeBodySchema = z.object({
  platform: z.enum(["ios", "android"]),
  expo_push_token: z.string().min(1).max(512),
});

const bodySchema = z.union([webBodySchema, nativeBodySchema]);

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

  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ ok: false, error: "no organisation on file" }, { status: 200 });
  }

  const { error } = "expo_push_token" in parsed.data
    ? await supabase.from("push_subscriptions").upsert(
        {
          organisation_id: profile.organisation_id,
          profile_id: user.id,
          platform: parsed.data.platform,
          expo_push_token: parsed.data.expo_push_token,
          user_agent: request.headers.get("user-agent") ?? null,
          last_seen_at: new Date().toISOString(),
          disabled_at: null,
        },
        { onConflict: "expo_push_token" },
      )
    : await supabase.from("push_subscriptions").upsert(
        {
          organisation_id: profile.organisation_id,
          profile_id: user.id,
          platform: "web",
          endpoint: parsed.data.endpoint,
          p256dh_key: parsed.data.keys.p256dh,
          auth_key: parsed.data.keys.auth,
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
