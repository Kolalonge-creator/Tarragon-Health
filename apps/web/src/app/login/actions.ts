"use server";

import { createClient } from "@/lib/supabase/server";
import {
  emailLoginSchema,
  phoneOtpRequestSchema,
  phoneOtpVerifySchema,
} from "@/lib/validation/auth";
import { redirectAfterLogin } from "@/lib/auth/redirect-after-login";
import { checkAuthRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { authErrorMessage } from "@/lib/auth/auth-error-message";
import { firstIssue } from "@/lib/validation/first-issue";

/** `field` names the control that failed, so the form can mark exactly that
 *  one `aria-invalid` and point its `aria-describedby` at the error text. */
export type LoginActionState =
  | { error?: string; field?: string; step?: "verify"; phone?: string }
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
  const { error } = await supabase.auth.signInWithOtp({ phone: parsed.data.phone });
  if (error) {
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
