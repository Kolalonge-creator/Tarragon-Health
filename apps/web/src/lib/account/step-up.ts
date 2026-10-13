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
 */
export type StepUpPurpose = "backup_codes" | "recovery_contact";
export type StepUpResult =
  | { ok: true }
  | { ok: false; reason: "wrong_password" | "no_password_route" | "rate_limited" | "unavailable" };

export async function verifyPasswordAndRecordStepUp(
  user: PhoneChangeUser & { id: string },
  password: string,
  purpose: StepUpPurpose,
): Promise<StepUpResult> {
  if (!password) return { ok: false, reason: "wrong_password" };

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
  if (error || !data.user || data.user.id !== user.id) return { ok: false, reason: "wrong_password" };
  // End the throw-away session so a check leaves no extra signed-in session behind.
  await probe.auth.signOut().catch(() => undefined);

  const { data: recorded, error: rpcError } = await createServiceRoleClient().rpc("record_step_up", {
    p_user: user.id,
    p_purpose: purpose,
  });
  if (rpcError || recorded !== true) {
    Sentry.captureMessage("step-up could not be recorded", "error");
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true };
}
