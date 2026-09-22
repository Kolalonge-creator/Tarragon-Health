"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  emailLoginSchema,
  phoneOtpRequestSchema,
  phoneOtpVerifySchema,
} from "@/lib/validation/auth";
import { resolveLoginDestination } from "@/lib/auth/redirect-after-login";
import { recordLoginDevice } from "@/lib/auth/record-login-device";
import { callLockoutRpc } from "@/lib/auth/lockout-rpc";
import { checkAuthRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { authErrorMessage, isInvalidCredentialsError } from "@/lib/auth/auth-error-message";
import { firstIssue } from "@/lib/validation/first-issue";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/** `field` names the control that failed, so the form can mark exactly that
 *  one `aria-invalid` and point its `aria-describedby` at the error text. */
export type LoginActionState =
  | { error?: string; field?: string; step?: "verify"; phone?: string }
  | undefined;

// If the account has a verified MFA factor, proxy.ts (the single choke
// point for auth gating — see its own header comment) catches the
// resulting aal1 session on the very next request and bounces it to
// /login/mfa-challenge before it reaches whatever page this sends it to.
// Nothing here needs to know about MFA at all.
async function redirectAfterLogin(
  supabase: SupabaseClient<Database>,
  userId: string,
  redirectTo: FormDataEntryValue | null
) {
  // Best-effort new-device detection/notification — never blocks a real
  // sign-in (see record-login-device.ts). Runs for every successful login
  // path that calls this shared helper.
  await recordLoginDevice(supabase);
  redirect(await resolveLoginDestination(supabase, userId, redirectTo?.toString()));
}

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

  // Real account-level lockout, distinct from the rolling rate limit above —
  // see 20260918111442_account_lockout_after_repeated_failed_logins.sql for
  // why the rate limit alone isn't a lockout (it resets every window, keeps
  // no record, and never notifies the account owner). Checked BEFORE
  // signInWithPassword so a locked account is refused without ever reaching
  // GoTrue. Returns false uniformly for an unknown email, so this reveals
  // nothing about whether the address has an account — same generic message
  // as the rate limit above either way. callLockoutRpc is best-effort (never
  // blocks a real sign-in on a transient failure) and reports a genuine
  // RPC-level error (e.g. a lost grant) to Sentry rather than treating it
  // identically to "no attacker" — see its own doc comment.
  const isLocked = Boolean(
    await callLockoutRpc<boolean>(supabase, "is_account_locked", { p_email: parsed.data.email })
  );
  if (isLocked) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    // Only a genuine wrong-password/wrong-email result counts toward the
    // lockout — never "email not confirmed", GoTrue's own rate limiting, or
    // a transient network error, all of which also surface as `error` here.
    // Without this, a patient who simply hasn't clicked their confirmation
    // email yet could get their real account locked out after 5 attempts
    // despite never entering a wrong password. See isInvalidCredentialsError's
    // own doc comment.
    if (isInvalidCredentialsError(error)) {
      // Deliberately the SERVICE-ROLE client, not the anon-key `supabase`
      // client used everywhere else in this file. record_failed_login() is
      // now granted EXECUTE to service_role only (see the migration's own
      // header comment): the anon key isn't a secret, so an earlier version
      // of this call — using the plain client, matching record_failed_login's
      // original anon+authenticated grant — let anyone who could reach this
      // RPC directly lock an arbitrary known account with no real login
      // attempt at all. Only this trusted server call, using a key never sent
      // to a browser, may record a failure.
      await callLockoutRpc(createServiceRoleClient(), "record_failed_login", {
        p_email: parsed.data.email,
      });
    }
    // Never the raw GoTrue string, and never anything that would confirm
    // whether this address has an account here.
    return { error: authErrorMessage(error, "sign_in") };
  }

  // Best-effort — never let lockout bookkeeping block a real sign-in.
  await callLockoutRpc(supabase, "clear_login_failures");

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

  // Checked here too, not just at verify — a locked account otherwise still
  // receives a real, live OTP SMS on every request (cost, and a spam vector
  // for the account owner) even though verifyPhoneOtp below would correctly
  // refuse the code.
  const isLocked = Boolean(
    await callLockoutRpc<boolean>(supabase, "is_account_locked_by_phone", { p_phone: parsed.data.phone })
  );
  if (isLocked) {
    return { error: RATE_LIMIT_MESSAGE };
  }

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

  // Same real account-level lockout as the password path (signInWithEmail
  // above) — see 20260918111442_account_lockout_after_repeated_failed_logins.sql.
  // Without this, an account locked out by repeated wrong-password attempts
  // could still be fully authenticated via phone OTP during the lock
  // window, which would make the lockout read as account-wide protection
  // without actually being one.
  const isLocked = Boolean(
    await callLockoutRpc<boolean>(supabase, "is_account_locked_by_phone", { p_phone: parsed.data.phone })
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
    // Deliberately does NOT call record_failed_login_by_phone here — found
    // and reverted before merge as a real vulnerability this migration
    // would have introduced, not a missed spot (same reasoning as guest-
    // checkout.ts's verifyGuestCheckoutOtp, which has the fuller writeup).
    // Unlike a wrong PASSWORD guess (signInWithEmail above), which requires
    // the caller to actually possess something not publicly knowable,
    // requestPhoneOtp needs only a phone number to trigger a real OTP send
    // — an attacker who does not own the phone can never receive the real
    // code, so every guess they submit here is GUARANTEED to fail, with
    // zero effort or risk. If failures here counted toward the shared
    // lockout counter, anyone who merely knows a victim's phone number
    // could submit 5 guesses they can never get right and lock the victim
    // out of BOTH password and phone-OTP login, repeatable indefinitely.
    // The is_account_locked_by_phone READ above still closes the real
    // bypass this was built for (a locked account can't complete phone-OTP
    // login either); the existing login-phone-verify rate limit above is
    // this endpoint's own, narrower protection against OTP brute-forcing.
    return {
      error: authErrorMessage(error, "otp_verify"),
      field: "token",
      step: "verify",
      phone: parsed.data.phone,
    };
  }

  // Best-effort — never let lockout bookkeeping block a real sign-in. Shares
  // the same clear_login_failures() the password path uses (scoped to the
  // now-authenticated auth.uid(), not to which method signed in).
  await callLockoutRpc(supabase, "clear_login_failures");

  await redirectAfterLogin(supabase, data.user.id, formData.get("redirectTo"));
}
