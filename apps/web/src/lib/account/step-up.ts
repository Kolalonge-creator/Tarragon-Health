import "server-only";

import * as Sentry from "@sentry/nextjs";
import { createClient as createStatelessClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { checkAuthRateLimit } from "@/lib/rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { e164FromAuthPhone, type PhoneChangeUser } from "./phone-change-options";

/**
 * A password step-up before the two actions that plant a way back into an account later (making backup codes, naming a recovery
 * contact). A session alone, such as a borrowed phone or a stolen access token, is not enough: the person must type the account
 * password again. The password is checked here with a throw-away client (the real session is untouched and the throw-away one is
 * ended at once); only then does the SERVER record a short, single-use step-up in the database (public.record_step_up, service
 * role), which the database function itself refuses to run without. So the proof is earned here and enforced there.
 *
 * The step-up is bound to the SESSION that typed the password (the `session_id` claim of its access token), so a second access
 * token for the same account cannot spend it.
 */
export type StepUpPurpose = "backup_codes" | "recovery_contact";

/**
 * The `session_id` claim of a Supabase access token, or null. Read only to BIND a step-up to the session that earned it: nothing
 * is trusted from this value, because the database compares it with the claim of the VERIFIED token that later spends the step-up.
 */
export function sessionIdFromAccessToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const claims = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { session_id?: unknown };
    return typeof claims.session_id === "string" && claims.session_id.length >= 8 && claims.session_id.length <= 64 ? claims.session_id : null;
  } catch {
    return null;
  }
}
export type StepUpResult =
  | { ok: true }
  | { ok: false; reason: "wrong_password" | "no_password_route" | "rate_limited" | "unavailable" };

export async function verifyPasswordAndRecordStepUp(
  user: PhoneChangeUser & { id: string },
  password: string,
  purpose: StepUpPurpose,
  sessionId: string | null,
): Promise<StepUpResult> {
  if (!password) return { ok: false, reason: "wrong_password" };
  // No session to bind to means no step-up (fail closed).
  if (!sessionId) return { ok: false, reason: "unavailable" };

  // Only a VERIFIED channel is used to check the password, and the address or number comes from Auth, never the request.
  const credentials =
    user.email && user.email_confirmed_at
      ? { email: user.email }
      : user.phone && user.phone_confirmed_at
        ? { phone: e164FromAuthPhone(user.phone) }
        : null;
  if (!credentials) return { ok: false, reason: "no_password_route" };

  const limited = await checkAuthRateLimit(
    "step-up",
    user.id,
    { limit: 20, windowSeconds: 900 },
    { limit: 6, windowSeconds: 900 },
  );
  if (!limited.success) return { ok: false, reason: "rate_limited" };

  const probe = createStatelessClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await probe.auth.signInWithPassword({ ...credentials, password });
  // End the throw-away session so a check leaves no extra signed-in session behind. scope 'local': signOut() defaults to 'global',
  // which would revoke EVERY session of this account, including the one the person is typing the password in.
  if (data?.session) await probe.auth.signOut({ scope: "local" }).catch(() => undefined);
  if (error || !data.user || data.user.id !== user.id) return { ok: false, reason: "wrong_password" };

  const { data: recorded, error: rpcError } = await createServiceRoleClient().rpc("record_step_up", {
    p_user: user.id,
    p_purpose: purpose,
    p_session: sessionId,
  });
  if (rpcError || recorded !== true) {
    Sentry.captureMessage("step-up could not be recorded", "error");
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true };
}
