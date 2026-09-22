import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { getClientIp } from "@/lib/rate-limit";
import { callRpc } from "@/lib/auth/lockout-rpc";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * Fingerprints the current request's device by its User-Agent alone (not IP —
 * see 20260829223329_known_device_login_notification.sql for why) and records
 * it against the just-authenticated profile via record_login_device(), which
 * queues an in_app + email notification server-side the first time a
 * fingerprint is seen for that profile.
 *
 * Deliberately best-effort: a failure here (RPC error, missing headers) must
 * never block a real login. Routed through callRpc — found in review, this
 * used to catch a thrown exception but never inspect a resolved RPC-level
 * `{data, error}` failure (permission denied, a lost grant), which would
 * silently disable new-device detection platform-wide with nothing logged.
 * See callRpc's own doc comment. Called from the password, phone-OTP and
 * guest-checkout success paths (login/actions.ts, guest-checkout.ts), right
 * before redirecting the user onward.
 */
export async function recordLoginDevice(supabase: SupabaseClient<Database>): Promise<void> {
  const h = await headers();
  const userAgent = h.get("user-agent") ?? "unknown";
  const ip = await getClientIp();
  const fingerprint = createHash("sha256").update(userAgent).digest("hex");

  await callRpc(supabase, "record_login_device", {
    p_device_fingerprint: fingerprint,
    p_user_agent: userAgent,
    p_ip: ip,
  });
}
