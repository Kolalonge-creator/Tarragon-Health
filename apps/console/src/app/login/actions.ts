"use server";

import { redirect } from "next/navigation";
import { createClient } from "@tarragon/auth/supabase/server";
import { emailLoginSchema } from "@tarragon/auth/credentials";
import { firstIssue } from "@tarragon/auth/first-issue";
import { checkAuthRateLimit, RATE_LIMIT_MESSAGE } from "@tarragon/auth/rate-limit";
import { authErrorMessage } from "@tarragon/auth/auth-error-message";
import { recordLoginDevice } from "@tarragon/auth/record-login-device";
import { loginGateTarget } from "@tarragon/auth/mfa-policy";
import { t } from "@tarragon/i18n";
import { canSignInToConsole, resolveConsoleDestination } from "@/lib/console-sign-in";

export type ConsoleLoginState = { error?: string; field?: string } | undefined;

/**
 * Email and password only. Staff accounts are provisioned by an admin; there
 * is no self-signup and no phone-OTP path on this host.
 */
export async function signInToConsole(
  _prev: ConsoleLoginState,
  formData: FormData
): Promise<ConsoleLoginState> {
  const parsed = emailLoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return firstIssue(parsed.error, t("console.login.check_credentials"));
  }

  // Same two-scope limit as the main app's login: per source IP, and per
  // target address to catch credential stuffing spread across many IPs.
  const limited = await checkAuthRateLimit(
    "console-login-email",
    parsed.data.email,
    { limit: 20, windowSeconds: 300 },
    { limit: 8, windowSeconds: 900 }
  );
  if (!limited.success) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    // Never the raw provider string, and nothing that confirms whether the
    // address has an account.
    return { error: authErrorMessage(error, "sign_in") };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();

  // Fail closed: an unreadable profile, or a role with no console area, gets
  // no session on this host. Signing out here clears only this host's cookie.
  if (!profile || !canSignInToConsole(profile.role)) {
    await supabase.auth.signOut();
    return { error: t("console.login.not_staff") };
  }

  // Best-effort new-device notification; never blocks a real sign-in.
  await recordLoginDevice(supabase);

  // proxy.ts never sees this redirect: Next renders a Server Action's redirect
  // target inside the same response. So the two 2FA gates are applied here: an
  // account with a factor goes to the challenge first, and an account whose
  // group requires 2FA and has none goes to the set-up page.
  const destination = resolveConsoleDestination(profile.role, formData.get("redirectTo")?.toString());
  redirect(
    await loginGateTarget(supabase, destination, {
      challengePath: "/login/mfa-challenge",
      setupPath: () => "/login/mfa-setup",
    }),
  );
}
