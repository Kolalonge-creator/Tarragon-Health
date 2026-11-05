import "server-only";
import { getClientIp } from "./rate-limit";
import { createServiceRoleClient } from "./supabase/service-role";
import { failedSignInRow, type FailedSignInMethod } from "./failed-sign-in-row";

export type { FailedSignInMethod } from "./failed-sign-in-row";

/**
 * Records one failed sign-in in audit_log (action auth.sign_in_failed) so the failed_sign_in_spike operations alert can see
 * credential stuffing and password guessing. Written through the service role because there is no session yet, and so a
 * caller cannot forge or flood rows through a public RPC: the only way in is a real failed attempt that already passed the
 * sign-in rate limit.
 *
 * The hash key is AUTH_AUDIT_HASH_KEY, falling back to the service-role key (always present on the server). Changing the key
 * only stops old and new failures for the same account grouping together; nothing else depends on it.
 *
 * Best-effort: a failure here must never change what the person sees, so every error is swallowed. Call it only after the
 * provider actually refused the credentials, never for a validation error or a rate-limited request.
 */
export async function recordFailedSignIn(identifier: string, method: FailedSignInMethod): Promise<void> {
  try {
    const hashKey = process.env.AUTH_AUDIT_HASH_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!hashKey) return;
    const ip = await getClientIp();
    // Capped so a slow database can never hold the "wrong password" answer open.
    const { error } = await createServiceRoleClient()
      .from("audit_log")
      .insert(failedSignInRow(identifier, method, ip, hashKey))
      .abortSignal(AbortSignal.timeout(2000));
    // A rejected insert would otherwise blind the failed_sign_in_spike alert silently. No identifier in the log line.
    if (error) console.error("recordFailedSignIn: audit insert failed", { method, code: error.code });
  } catch {
    // never let security bookkeeping break or slow down the sign-in answer
  }
}
