"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  passwordResetEmailSchema,
  phoneOtpRequestSchema,
  phoneOtpVerifySchema,
} from "@/lib/validation/auth";
import { callLockoutRpc } from "@/lib/auth/lockout-rpc";
import { checkAuthRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { authErrorMessage, isInvalidOtpError } from "@/lib/auth/auth-error-message";
import { firstIssue } from "@/lib/validation/first-issue";

export type ForgotPasswordActionState =
  | { error?: string; field?: string; success?: boolean; step?: "verify"; phone?: string }
  | undefined;

/** Sends a password-reset link to the given email via Supabase Auth. */
export async function requestPasswordResetEmail(
  _prevState: ForgotPasswordActionState,
  formData: FormData
): Promise<ForgotPasswordActionState> {
  const parsed = passwordResetEmailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return firstIssue(parsed.error, "Enter a valid email address.");
  }

  // Email-scoped limit stops one target address being email-bombed with
  // reset links from many different source IPs.
  const limited = await checkAuthRateLimit(
    "forgot-password-email",
    parsed.data.email,
    { limit: 10, windowSeconds: 300 },
    { limit: 5, windowSeconds: 900 }
  );
  if (!limited.success) {
    // Safe to show plainly, unlike the errors below: the limiter keys on the
    // submitted string itself, before any lookup, so this reveals nothing
    // about whether the address is a real account.
    return { error: RATE_LIMIT_MESSAGE };
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL;
  const supabase = await createClient();
  // Supabase never reveals whether the email is registered — this always
  // "succeeds" client-side even for an unknown address, which is the
  // intended anti-enumeration behaviour, so a generic success message is
  // shown regardless (errors here are transport/rate-limit failures only).
  // redirectTo only needs to satisfy the project's redirect-URL allow-list —
  // the actual post-verify destination is hardcoded in the "Reset Password"
  // email template's link to /auth/confirm (see that route for why: the
  // hosted recovery link can't go through /auth/callback's `?code=` flow).
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/reset-password`,
  });
  if (error) {
    return { error: "We could not send the reset email just then. Please try again." };
  }

  return { success: true };
}

/** Phone-side of forgot-password reuses the same OTP flow as phone login. */
export async function requestPhoneReset(
  _prevState: ForgotPasswordActionState,
  formData: FormData
): Promise<ForgotPasswordActionState> {
  const parsed = phoneOtpRequestSchema.safeParse({
    countryCode: formData.get("countryCode"),
    phone: formData.get("phone"),
  });
  if (!parsed.success) {
    return firstIssue(parsed.error, "Check the phone number and try again.");
  }

  const limited = await checkAuthRateLimit(
    "forgot-password-phone",
    parsed.data.phone,
    { limit: 10, windowSeconds: 300 },
    { limit: 5, windowSeconds: 900 }
  );
  if (!limited.success) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const supabase = await createClient();

  // Checked here too, not just at verifyPhoneReset — a locked account
  // otherwise still receives a real, live OTP SMS on every request even
  // though the verify step would correctly refuse it. Deliberately the same
  // "no bypass via any method" stance the lockout takes everywhere else in
  // this codebase: an OTP code is itself guessable within a rate-limited
  // window, so letting phone-reset override a password lockout would just
  // move the attack surface rather than closing it — the legitimate
  // recovery path while locked is to wait out the 15 minutes, same as any
  // other entry point.
  const isLocked = Boolean(
    await callLockoutRpc<boolean>(supabase, "is_account_locked_by_phone", {
      p_phone: parsed.data.phone,
    })
  );
  if (isLocked) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const { error } = await supabase.auth.signInWithOtp({ phone: parsed.data.phone });
  if (error) {
    // Same anti-enumeration reasoning as the email path above: the mapped
    // wording never distinguishes "no such account" from a send failure.
    return { error: authErrorMessage(error, "otp_send"), field: "phone" };
  }

  return { step: "verify", phone: parsed.data.phone };
}

/**
 * Verifying the code establishes a real session (same as phone login) —
 * that session is what lets /reset-password call auth.updateUser().
 */
export async function verifyPhoneReset(
  _prevState: ForgotPasswordActionState,
  formData: FormData
): Promise<ForgotPasswordActionState> {
  const parsed = phoneOtpVerifySchema.safeParse({
    phone: formData.get("phone"),
    token: formData.get("token"),
  });
  if (!parsed.success) {
    return {
      ...firstIssue(parsed.error, "Check the code and try again."),
      step: "verify",
      phone: formData.get("phone")?.toString(),
    };
  }

  const limited = await checkAuthRateLimit(
    "forgot-password-phone-verify",
    parsed.data.phone,
    { limit: 20, windowSeconds: 300 },
    { limit: 8, windowSeconds: 900 }
  );
  if (!limited.success) {
    return { error: RATE_LIMIT_MESSAGE, step: "verify", phone: parsed.data.phone };
  }

  const supabase = await createClient();

  // Same real account-level lockout the login flow enforces (see
  // 20260918111442_account_lockout_after_repeated_failed_logins.sql) —
  // without this, an account locked out by repeated failed sign-in attempts
  // could still be reached (and its password CHANGED) by brute-forcing an
  // OTP through the forgot-password flow, a full bypass of the lockout
  // rather than a missed spot. Best-effort, same posture as login/actions.ts:
  // a transient failure here must never itself block a real request.
  const isLocked = Boolean(
    await callLockoutRpc<boolean>(supabase, "is_account_locked_by_phone", {
      p_phone: parsed.data.phone,
    })
  );
  if (isLocked) {
    return { error: RATE_LIMIT_MESSAGE, step: "verify", phone: parsed.data.phone };
  }

  const { data, error } = await supabase.auth.verifyOtp({
    phone: parsed.data.phone,
    token: parsed.data.token,
    type: "sms",
  });
  if (error || !data.user) {
    // Only a genuine wrong/expired code counts toward the lockout — never a
    // rate-limit or network error. Service-role-only, same reasoning as
    // login/actions.ts: the anon key is not a secret.
    if (isInvalidOtpError(error)) {
      await callLockoutRpc(createServiceRoleClient(), "record_failed_login_by_phone", {
        p_phone: parsed.data.phone,
      });
    }
    return {
      error: authErrorMessage(error, "otp_verify"),
      field: "token",
      step: "verify",
      phone: parsed.data.phone,
    };
  }

  // Best-effort — never let lockout bookkeeping block a real reset.
  await callLockoutRpc(supabase, "clear_login_failures");

  redirect("/reset-password");
}
