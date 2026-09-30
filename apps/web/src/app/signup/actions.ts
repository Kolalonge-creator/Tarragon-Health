"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { phoneOtpVerifySchema, phoneSignupSchema, signupSchema } from "@/lib/validation/auth";
import { checkPasswordAcceptable } from "@tarragon/auth/password-check";
import { authErrorKey } from "@tarragon/auth/auth-error-key";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";
import { getAuthLocale } from "@/lib/auth/auth-locale";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation/password";
import { checkAuthRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { authErrorMessage } from "@/lib/auth/auth-error-message";
import { firstIssue } from "@/lib/validation/first-issue";
import { sanitizeRedirect } from "@/lib/auth/redirect";
import { redirectAfterLogin } from "@/lib/auth/redirect-after-login";
import { backfillSignupMetadata } from "@/lib/auth/backfill-signup-metadata";

export type SignupActionState =
  | { error?: string; field?: string; success?: boolean; step?: "verify"; phone?: string; redirectTo?: string; sentAt?: number }
  | undefined;

/**
 * Public self-serve signup always provisions a `patient` profile — this
 * matches `private.handle_new_user`'s default in
 * supabase/migrations/20260705000001_core_auth_multitenancy.sql. Role/org
 * assignment for staff is a server/admin-controlled operation, never a field
 * on this form.
 */
export async function signUp(
  _prevState: SignupActionState,
  formData: FormData
): Promise<SignupActionState> {
  const parsed = signupSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    countryCode: formData.get("countryCode"),
    phone: formData.get("phone"),
    state: formData.get("state"),
    refCode: formData.get("refCode"),
    intent: formData.get("intent"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return firstIssue(parsed.error, "Check the details above and try again.");
  }

  // IP-scoped (10/hour) blunts scripted mass account creation; email-scoped
  // (3/hour) stops someone repeatedly triggering Supabase's confirmation
  // email at one address.
  const limited = await checkAuthRateLimit(
    "signup",
    parsed.data.email,
    { limit: 10, windowSeconds: 3600 },
    { limit: 3, windowSeconds: 3600 }
  );
  if (!limited.success) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const verdict = await checkPasswordAcceptable(parsed.data.password);
  if (!verdict.ok) {
    return { error: verdict.message, field: "password" };
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL;
  const supabase = await createClient();

  // Threaded from SignupForm's hidden redirectTo field (e.g. a
  // sponsored_service_reservations claim link) — sanitized the same way
  // /auth/callback itself re-sanitizes redirectParam on the way back, so a
  // crafted redirectTo can't smuggle an open redirect into the confirmation
  // email even though this is the write side, not the read side, of that check.
  const redirectTo = sanitizeRedirect(formData.get("redirectTo")?.toString());
  const emailRedirectTo = `${origin}/auth/callback${redirectTo ? `?redirect=${encodeURIComponent(redirectTo)}` : ""}`;

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo,
      // auth.users.phone is only set by phone-identity signup; carrying the
      // phone (and optional state/ref_code) here lets /auth/callback backfill
      // profiles.phone/state and auto-redeem a referral code once the user
      // confirms and we have a session to act under RLS.
      data: {
        full_name: parsed.data.fullName,
        phone: parsed.data.phone,
        ...(parsed.data.state ? { state: parsed.data.state } : {}),
        ...(parsed.data.refCode ? { ref_code: parsed.data.refCode } : {}),
        ...(parsed.data.intent ? { signup_intent: parsed.data.intent } : {}),
        // Someone signing up to pay for a relative's care rather than to be
        // treated. /auth/callback turns this into profiles.account_purpose,
        // which is what lets them skip consenting to telehealth for
        // themselves — see 20260801093000_supporter_accounts.sql.
        ...(parsed.data.intent === "support" ? { account_purpose: "support" } : {}),
      },
    },
  });
  if (error) {
    // GoTrue's raw string leaked its own 6-character minimum here, which
    // directly contradicted the 8-character rule this form enforces and is
    // now shown under the password field.
    return { error: authErrorMessage(error, "sign_up") };
  }

  // A project with email confirmations turned off (this one, currently) hands
  // back a live session immediately — there is no confirmation email to wait
  // for, and telling the visitor to go check one is actively wrong (worse,
  // they're already signed in). Only show the "check your email" state when
  // GoTrue actually deferred confirmation, i.e. there's no session yet.
  if (data?.session && data?.user) {
    const user = data.user;
    // Normally /auth/callback's exchangeCodeForSession is what does this,
    // right after a confirmation-link click — this path never reaches that
    // route, so it has to do the same backfill/redemption itself, or a
    // referral code and the phone/state typed into this very form would
    // silently never be applied.
    await backfillSignupMetadata(supabase, user, "signUp");
    await redirectAfterLogin(supabase, user.id, redirectTo);
  }

  return { success: true };
}


/**
 * Validation messages from the shared Zod schemas are English. On the phone flows the two failures a person can
 * actually hit (a number that cannot be real, a code that is not six digits) are replaced with the catalogue wording
 * so they read in the chosen language too; `field` tells us which one it was.
 */
function localisedIssue(
  issue: { error?: string; field?: string } | undefined,
  locale: Locale,
  fallbackKey?: MessageKey
): { error?: string; field?: string } {
  if (!issue) return {};
  if (issue.field === "phone") return { ...issue, error: t("auth.error.invalid_phone", locale) };
  if (issue.field === "token" && fallbackKey) return { ...issue, error: t(fallbackKey, locale) };
  return issue;
}
/**
 * Phone-first sign-up (S03, functions 1.1 and 1.2). Creates the account on the phone identity with a password; GoTrue
 * then asks the Send SMS hook to deliver a six-digit code, and the account cannot sign in until that code is verified
 * (`[auth.sms] enable_confirmations`), so a mistyped number is never attached to a usable account.
 */
export async function signUpWithPhone(
  _prevState: SignupActionState,
  formData: FormData
): Promise<SignupActionState> {
  const locale = await getAuthLocale();
  const parsed = phoneSignupSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    countryCode: formData.get("countryCode"),
    phone: formData.get("phone"),
    state: formData.get("state"),
    refCode: formData.get("refCode"),
    intent: formData.get("intent"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return localisedIssue(firstIssue(parsed.error, "Check the details above and try again."), locale);
  }

  // Keyed on the phone as well as the IP: every attempt costs an SMS, and the hook's own per-phone hourly cap is the
  // backstop, not the first line.
  const limited = await checkAuthRateLimit(
    "signup-phone",
    parsed.data.phone,
    { limit: 10, windowSeconds: 3600 },
    { limit: 3, windowSeconds: 3600 }
  );
  if (!limited.success) {
    return { error: t("auth.error.rate_limited", locale) };
  }

  const verdict = await checkPasswordAcceptable(parsed.data.password);
  if (!verdict.ok) {
    return {
      error: verdict.reason === "breached" ? t("auth.password.breached", locale, { min: PASSWORD_MIN_LENGTH }) : verdict.message,
      field: "password",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    phone: parsed.data.phone,
    password: parsed.data.password,
    options: {
      data: {
        full_name: parsed.data.fullName,
        ...(parsed.data.state ? { state: parsed.data.state } : {}),
        ...(parsed.data.refCode ? { ref_code: parsed.data.refCode } : {}),
        ...(parsed.data.intent ? { signup_intent: parsed.data.intent } : {}),
        ...(parsed.data.intent === "support" ? { account_purpose: "support" } : {}),
      },
    },
  });
  if (error) {
    return { error: t(authErrorKey(error, "sign_up"), locale), field: "phone" };
  }

  return {
    step: "verify",
    phone: parsed.data.phone,
    redirectTo: sanitizeRedirect(formData.get("redirectTo")?.toString()) ?? undefined,
  };
}

/** Confirms the phone with the six-digit code. Success creates the session, so the usual post-signup work runs. */
export async function verifySignupPhone(
  _prevState: SignupActionState,
  formData: FormData
): Promise<SignupActionState> {
  const locale = await getAuthLocale();
  const parsed = phoneOtpVerifySchema.safeParse({
    phone: formData.get("phone"),
    token: formData.get("token"),
  });
  const redirectTo = sanitizeRedirect(formData.get("redirectTo")?.toString()) ?? undefined;
  if (!parsed.success) {
    return {
      ...localisedIssue(firstIssue(parsed.error, "Check the code and try again."), locale, "auth.error.wrong_code"),
      step: "verify",
      phone: formData.get("phone")?.toString(),
      redirectTo,
    };
  }

  // A six-digit code is only a million guesses, so the verify step is limited on the phone as well as the IP.
  const limited = await checkAuthRateLimit(
    "signup-phone-verify",
    parsed.data.phone,
    { limit: 20, windowSeconds: 300 },
    { limit: 8, windowSeconds: 900 }
  );
  if (!limited.success) {
    return { error: t("auth.error.rate_limited", locale), step: "verify", phone: parsed.data.phone, redirectTo };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    phone: parsed.data.phone,
    token: parsed.data.token,
    type: "sms",
  });
  if (error || !data.user) {
    return {
      error: t(authErrorKey(error, "otp_verify"), locale),
      field: "token",
      step: "verify",
      phone: parsed.data.phone,
      redirectTo,
    };
  }

  await backfillSignupMetadata(supabase, data.user, "verifySignupPhone");
  await redirectAfterLogin(supabase, data.user.id, redirectTo);
}

/** Asks for a fresh code. GoTrue enforces the 60 second gap; the hook enforces the per-phone hourly cap. */
export async function resendSignupCode(
  _prevState: SignupActionState,
  formData: FormData
): Promise<SignupActionState> {
  const locale = await getAuthLocale();
  const phone = formData.get("phone")?.toString() ?? "";
  const redirectTo = sanitizeRedirect(formData.get("redirectTo")?.toString()) ?? undefined;
  const parsed = phoneOtpVerifySchema.shape.phone.safeParse(phone);
  if (!parsed.success) {
    return { error: t("auth.error.invalid_phone", locale), step: "verify", phone, redirectTo };
  }

  const limited = await checkAuthRateLimit(
    "signup-phone-resend",
    parsed.data,
    { limit: 10, windowSeconds: 3600 },
    { limit: 5, windowSeconds: 3600 }
  );
  if (!limited.success) {
    return { error: t("auth.error.rate_limited", locale), step: "verify", phone: parsed.data, redirectTo };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({ type: "sms", phone: parsed.data });
  if (error) {
    return { error: t(authErrorKey(error, "otp_send"), locale), step: "verify", phone: parsed.data, redirectTo };
  }
  // sentAt changes on every successful resend; the client keys its countdown on it so each resend restarts at 60.
  return { step: "verify", phone: parsed.data, redirectTo, sentAt: Date.now() };
}
