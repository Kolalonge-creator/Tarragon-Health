"use server";

import { createClient } from "@/lib/supabase/server";
import {
  emailLoginSchema,
  phoneOtpRequestSchema,
  phoneOtpVerifySchema,
  phonePasswordLoginSchema,
} from "@/lib/validation/auth";
import { authErrorKey } from "@tarragon/auth/auth-error-key";
import { t } from "@tarragon/i18n";
import { getAuthLocale } from "@/lib/auth/auth-locale";
import { redirectAfterLogin } from "@/lib/auth/redirect-after-login";
import { checkAuthRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { authErrorMessage } from "@/lib/auth/auth-error-message";
import { firstIssue } from "@/lib/validation/first-issue";
import { isRateLimitOtpError, isUnknownUserOtpError } from "@/lib/auth/otp-errors";

/** `field` names the control that failed, so the form can mark exactly that
 *  one `aria-invalid` and point its `aria-describedby` at the error text. */
export type LoginActionState =
  | { error?: string; field?: string; step?: "verify"; phone?: string; notice?: string }
  | undefined;

export async function signInWithEmail(
  _prevState: LoginActionState,
  formData: FormData
): Promise<LoginActionState> {
  const parsed = emailLoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return firstIssue(parsed.error, "Check your email and password, then try again.");
  }

  // IP-scoped (20/5min) catches one source hammering many accounts;
  // email-scoped (8/15min) catches credential stuffing spread across many
  // IPs against one target account, which the IP limit alone would miss.
  const limited = await checkAuthRateLimit(
    "login-email",
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
    // Never the raw GoTrue string, and never anything that would confirm
    // whether this address has an account here.
    return { error: authErrorMessage(error, "sign_in") };
  }

  await redirectAfterLogin(supabase, data.user.id, formData.get("redirectTo"));
}

export async function requestPhoneOtp(
  _prevState: LoginActionState,
  formData: FormData
): Promise<LoginActionState> {
  const parsed = phoneOtpRequestSchema.safeParse({
    countryCode: formData.get("countryCode"),
    phone: formData.get("phone"),
  });
  if (!parsed.success) {
    return firstIssue(parsed.error, "Check the phone number and try again.");
  }

  // Each request sends a real SMS (Termii cost + spam-bombing surface), so
  // this stays tighter than a plain login attempt.
  const limited = await checkAuthRateLimit(
    "login-phone-otp",
    parsed.data.phone,
    { limit: 10, windowSeconds: 300 },
    { limit: 5, windowSeconds: 900 }
  );
  if (!limited.success) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const supabase = await createClient();
  // shouldCreateUser:false - asking for a code must never CREATE an account (it used to: an unknown number got a
  // brand-new phone-only user). Whether the number is registered is never revealed: an unknown number gets the same
  // "code sent" screen as a real one, and the code entry simply fails.
  const { error } = await supabase.auth.signInWithOtp({
    phone: parsed.data.phone,
    options: { shouldCreateUser: false },
  });
  if (error && !isUnknownUserOtpError(error) && !isRateLimitOtpError(error)) {
    return { error: authErrorMessage(error, "otp_send"), field: "phone" };
  }

  return { step: "verify", phone: parsed.data.phone };
}

export async function verifyPhoneOtp(
  _prevState: LoginActionState,
  formData: FormData
): Promise<LoginActionState> {
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

  // A 6-digit code is only 1M possibilities — without this, the request step
  // above being rate-limited doesn't stop someone brute-forcing a code
  // they've already been sent.
  const limited = await checkAuthRateLimit(
    "login-phone-verify",
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

  await redirectAfterLogin(supabase, data.user.id, formData.get("redirectTo"));
}

/**
 * Sign in with a phone number and password (S03, function 1.3). A number that was never confirmed cannot sign in;
 * GoTrue says so only AFTER the password matched, so this cannot be used to probe which numbers are registered.
 * When that happens a fresh code is sent and the screen moves to the verify step, where entering it confirms the
 * number and signs the person in (the same verifyPhoneOtp step the code sign-in uses).
 */
export async function signInWithPhonePassword(
  _prevState: LoginActionState,
  formData: FormData
): Promise<LoginActionState> {
  const locale = await getAuthLocale();
  const parsed = phonePasswordLoginSchema.safeParse({
    countryCode: formData.get("countryCode"),
    phone: formData.get("phone"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    const issue = firstIssue(parsed.error, t("auth.error.sign_in_failed", locale));
    return issue?.field === "phone" ? { ...issue, error: t("auth.error.invalid_phone", locale) } : issue;
  }

  // Same shape as the email limiter: a per-IP cap for one source hammering many accounts, and a per-phone cap for
  // credential stuffing spread across many IPs against one number.
  const limited = await checkAuthRateLimit(
    "login-phone-password",
    parsed.data.phone,
    { limit: 20, windowSeconds: 300 },
    { limit: 8, windowSeconds: 900 }
  );
  if (!limited.success) {
    return { error: t("auth.error.rate_limited", locale) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    phone: parsed.data.phone,
    password: parsed.data.password,
  });
  if (error || !data.user) {
    if (authErrorKey(error, "sign_in") === "auth.signin.unverified") {
      const resendLimited = await checkAuthRateLimit(
        "login-phone-confirm-resend",
        parsed.data.phone,
        { limit: 10, windowSeconds: 3600 },
        { limit: 5, windowSeconds: 3600 }
      );
      if (resendLimited.success) {
        const { error: resendError } = await supabase.auth.resend({ type: "sms", phone: parsed.data.phone });
        // A code that could not be sent must not be announced as sent. A rate-limit answer is fine: a code from the
        // last minute is already on its way and the verify step says so.
        if (resendError && !isRateLimitOtpError(resendError)) {
          return { error: t(authErrorKey(resendError, "otp_send"), locale) };
        }
      }
      return { step: "verify", phone: parsed.data.phone, notice: t("auth.signin.unverified", locale) };
    }
    return { error: t(authErrorKey(error, "sign_in"), locale) };
  }

  await redirectAfterLogin(supabase, data.user.id, formData.get("redirectTo"));
}
