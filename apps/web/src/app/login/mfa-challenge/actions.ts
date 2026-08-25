"use server";

import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { mfaCodeSchema } from "@/lib/validation/auth";
import { resolveLoginDestination } from "@/lib/auth/redirect-after-login";
import { checkAuthRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

export type MfaChallengeState = { error?: string } | undefined;

export async function verifyLoginMfaChallenge(
  _prevState: MfaChallengeState,
  formData: FormData
): Promise<MfaChallengeState> {
  const parsed = mfaCodeSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid code" };
  }

  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // A 6-digit code is only 1M possibilities. This session already required a
  // correct password to reach aal1, so the attacker population here is
  // narrower than at plain login, but a per-account guess limit is still
  // what makes the second factor mean anything.
  const limited = await checkAuthRateLimit(
    "mfa-challenge",
    user.id,
    { limit: 20, windowSeconds: 300 },
    { limit: 8, windowSeconds: 900 }
  );
  if (!limited.success) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const supabase = await createClient();

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp.find((f) => f.status === "verified");
  if (!factor) {
    // Nothing enrolled after all (e.g. turned off in another tab mid-flow) —
    // there's nothing left to challenge, so just carry on.
    redirect(
      await resolveLoginDestination(supabase, user.id, formData.get("redirectTo")?.toString())
    );
  }

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId: factor.id,
  });
  if (challengeError || !challenge) {
    return { error: challengeError?.message ?? "Something went wrong — try again" };
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId: factor.id,
    challengeId: challenge.id,
    code: parsed.data.code,
  });
  if (verifyError) {
    return { error: "That code didn't match — check the app and try again" };
  }

  redirect(
    await resolveLoginDestination(supabase, user.id, formData.get("redirectTo")?.toString())
  );
}
