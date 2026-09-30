"use server";

import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@tarragon/auth/supabase/server";
import { mfaCodeSchema } from "@tarragon/auth/credentials";
import { firstIssue } from "@tarragon/auth/first-issue";
import { checkAuthRateLimit, RATE_LIMIT_MESSAGE } from "@tarragon/auth/rate-limit";
import { authErrorMessage } from "@tarragon/auth/auth-error-message";
import { t } from "@tarragon/i18n";
import { canSignInToConsole, resolveConsoleDestination } from "@/lib/console-sign-in";

export type MfaChallengeState = { error?: string; field?: string } | undefined;

async function landOrLeave(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  redirectTo: string | undefined
): Promise<never> {
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).single();
  if (!profile || !canSignInToConsole(profile.role)) {
    await supabase.auth.signOut();
    redirect("/login");
  }
  redirect(resolveConsoleDestination(profile.role, redirectTo));
}

export async function verifyConsoleMfaChallenge(
  _prev: MfaChallengeState,
  formData: FormData
): Promise<MfaChallengeState> {
  const parsed = mfaCodeSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) {
    return firstIssue(parsed.error, t("console.mfa.enter_code"));
  }

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // A 6-digit code is 1M possibilities; the per-account limit is what makes
  // the second factor mean anything.
  const limited = await checkAuthRateLimit(
    "console-mfa-challenge",
    user.id,
    { limit: 20, windowSeconds: 300 },
    { limit: 8, windowSeconds: 900 }
  );
  if (!limited.success) return { error: RATE_LIMIT_MESSAGE };

  const supabase = await createClient();
  const redirectTo = formData.get("redirectTo")?.toString();

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp.find((f) => f.status === "verified");
  if (!factor) {
    // Nothing enrolled after all (turned off in another tab): nothing to challenge.
    return landOrLeave(supabase, user.id, redirectTo);
  }

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId: factor.id,
  });
  if (challengeError || !challenge) {
    return { error: authErrorMessage(challengeError, "mfa_setup") };
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId: factor.id,
    challengeId: challenge.id,
    code: parsed.data.code,
  });
  if (verifyError) {
    return { error: t("console.mfa.wrong_code"), field: "code" };
  }

  return landOrLeave(supabase, user.id, redirectTo);
}
