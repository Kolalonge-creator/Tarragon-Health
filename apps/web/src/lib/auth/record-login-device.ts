import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { getClientIp } from "@/lib/rate-limit";
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
 * never block a real login. Called from the password and phone-OTP success
 * paths in login/actions.ts, right before redirectAfterLogin().
 */
export async function recordLoginDevice(supabase: SupabaseClient<Database>): Promise<void> {
  try {
    const h = await headers();
    const userAgent = h.get("user-agent") ?? "unknown";
    const ip = await getClientIp();
    const fingerprint = createHash("sha256").update(userAgent).digest("hex");

    await supabase.rpc("record_login_device", {
      p_device_fingerprint: fingerprint,
      p_user_agent: userAgent,
      p_ip: ip,
    });
  } catch {
    // Best-effort only — never let device-notification bookkeeping break a
    // real sign-in. The RPC derives the profile from auth.uid() itself (a
    // real session is guaranteed by the time this is called).
  }
}
