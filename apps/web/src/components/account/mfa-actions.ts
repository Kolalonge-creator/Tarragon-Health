"use server";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { mfaCodeSchema } from "@/lib/validation/auth";
import { checkAuthRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { authErrorMessage } from "@/lib/auth/auth-error-message";
import { firstIssue } from "@/lib/validation/first-issue";

export type MfaEnrollState =
  | { step: "enrolling"; factorId: string; qrCode: string; secret: string; error?: string }
  | { step: "idle"; error?: string }
  | undefined;

/**
 * Starts (or restarts) TOTP enrollment. Clears out any unverified factor
 * left over from an abandoned previous attempt first — Supabase caps the
 * number of factors per user, and an abandoned attempt would otherwise
 * accumulate one every time someone opens this card without finishing.
 * Never touches an already-verified factor.
 */
export async function startMfaEnrollment(): Promise<MfaEnrollState> {
  const user = await getCurrentUser();
  if (!user) {
    return { step: "idle", error: "Your session has expired. Sign in again, then retry." };
  }

  const supabase = await createClient();

  const { data: existing } = await supabase.auth.mfa.listFactors();
  const stale = existing?.all.find((f) => f.factor_type === "totp" && f.status === "unverified");
  if (stale) {
    await supabase.auth.mfa.unenroll({ factorId: stale.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    issuer: "TarragonHealth",
  });
  if (error || !data) {
    return { step: "idle", error: authErrorMessage(error, "mfa_setup") };
  }

  return {
    step: "enrolling",
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

export type MfaVerifyState = { success?: boolean; error?: string; field?: string } | undefined;

/** Confirms enrollment with the 6-digit code from the authenticator app —
 * the factor only becomes `verified` (and therefore able to step up a
 * session to aal2) after this succeeds. */
export async function verifyMfaEnrollment(
  _prevState: MfaVerifyState,
  formData: FormData
): Promise<MfaVerifyState> {
  const factorId = formData.get("factorId")?.toString();
  if (!factorId) return { error: "That setup has expired. Start it again." };

  const parsed = mfaCodeSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) {
    return firstIssue(parsed.error, "Enter the 6-digit code from your authenticator app.");
  }

  const user = await getCurrentUser();
  if (!user) return { error: "Your session has expired. Sign in again, then retry." };

  const limited = await checkAuthRateLimit(
    "mfa-enroll-verify",
    user.id,
    { limit: 20, windowSeconds: 300 },
    { limit: 8, windowSeconds: 900 }
  );
  if (!limited.success) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const supabase = await createClient();
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId,
  });
  if (challengeError || !challenge) {
    return { error: authErrorMessage(challengeError, "mfa_setup") };
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code: parsed.data.code,
  });
  if (verifyError) {
    return { error: "That code did not match. Check the app and try again.", field: "code" };
  }

  return { success: true };
}

export type MfaUnenrollState = { success?: boolean; error?: string } | undefined;

export async function turnOffMfa(
  _prevState: MfaUnenrollState,
  formData: FormData
): Promise<MfaUnenrollState> {
  const factorId = formData.get("factorId")?.toString();
  if (!factorId) return { error: "There is nothing to turn off." };

  const user = await getCurrentUser();
  if (!user) return { error: "Your session has expired. Sign in again, then retry." };

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) {
    return { error: authErrorMessage(error, "mfa_setup") };
  }
  return { success: true };
}
