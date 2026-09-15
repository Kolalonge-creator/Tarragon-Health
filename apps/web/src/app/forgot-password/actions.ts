"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  passwordResetEmailSchema,
  phoneOtpRequestSchema,
  phoneOtpVerifySchema,
} from "@/lib/validation/auth";
import { checkAuthRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { authErrorMessage } from "@/lib/auth/auth-error-message";
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
  const { data, error } = await supabase.auth.verifyOtp({
    phone: parsed.data.phone,
    token: parsed.data.token,
    type: "sms",
  });
  if (error || !data.user) {
    return {
      error: authErrorMessage(error, "otp_verify"),
      field: "token",
      step: "verify",
      phone: parsed.data.phone,
    };
  }

  redirect("/reset-password");
}
