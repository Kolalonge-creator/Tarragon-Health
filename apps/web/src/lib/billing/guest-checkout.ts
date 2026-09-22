"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { purchaseServiceProduct } from "@/lib/billing/purchase-service-product";
import { isGuestCheckoutProductCode } from "@/lib/billing/guest-checkout-products";
import {
  guestCheckoutSchema,
  guestCheckoutVerifySchema,
  combineGuestPhone,
} from "@/lib/validation/guest-checkout";
import { callLockoutRpc } from "@/lib/auth/lockout-rpc";
import { recordLoginDevice } from "@/lib/auth/record-login-device";
import { stampActivityCookie } from "@/lib/auth/idle-timeout";
import { checkAuthRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { authErrorMessage } from "@/lib/auth/auth-error-message";
import { firstIssue } from "@/lib/validation/first-issue";

export type GuestCheckoutState =
  | { error?: string; field?: string; step?: "verify"; email?: string }
  | undefined;

/**
 * Step 1: buys a paid service for someone with no Tarragon account — by
 * emailing them a real 6-digit code, the same passwordless mechanism phone
 * login already uses (requestPhoneOtp/verifyPhoneOtp), just email-keyed
 * instead of phone-keyed and typed rather than clicked.
 *
 * A CLICKABLE magic link was tried first and dropped after a live test:
 * Supabase's hosted /verify endpoint rejected the click with "One-time
 * token not found" — the well-documented failure mode where an email
 * provider's own link-safety scanner (Gmail's link prefetching, Outlook
 * Safe Links, etc.) visits and consumes a single-use link before the real
 * person ever clicks it. A typed code sidesteps that entirely: nothing
 * automated can read a number out of an email body and type it into a
 * form. It also sidesteps a second, independent snag that same test hit —
 * emailRedirectTo only works if pointed at a URL on this Supabase project's
 * allow-listed redirect list, which a preview deployment isn't on.
 *
 * This deliberately does NOT use the service-role client or
 * admin.createUser/admin.generateLink: signInWithOtp with
 * shouldCreateUser:true is the documented way to both provision an account
 * and send a real code in one call — it silently no-ops into "send an
 * existing user their login code" if the email is already registered, so a
 * returning guest is handled identically with no special branch needed.
 *
 * `data` becomes the new user's user_metadata exactly like signUp's
 * `options.data` does — full_name and phone are picked up by
 * private.handle_new_user (full_name) and, for phone specifically, need no
 * backfill route the way /auth/callback provides for a real signup, because
 * verifyGuestCheckoutOtp below runs in the same request that establishes
 * the session and can backfill it directly.
 */
export async function startGuestCheckout(
  serviceProductCode: string,
  _prevState: GuestCheckoutState,
  formData: FormData
): Promise<GuestCheckoutState> {
  if (!isGuestCheckoutProductCode(serviceProductCode)) {
    return { error: "This isn't available without an account. Please sign in or sign up first." };
  }

  const parsed = guestCheckoutSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    countryCode: formData.get("countryCode"),
    phone: formData.get("phone"),
  });
  if (!parsed.success) {
    return firstIssue(parsed.error, "Check your details and try again.");
  }
  const { fullName, email } = parsed.data;
  const phone = combineGuestPhone(parsed.data);

  // Same reasoning as signup's own limit (this can provision an account
  // too) paired with requestPhoneOtp's ("each request sends a real
  // message") — tighter than a plain login attempt.
  const limited = await checkAuthRateLimit(
    "guest-checkout",
    email,
    { limit: 10, windowSeconds: 3600 },
    { limit: 3, windowSeconds: 3600 }
  );
  if (!limited.success) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const supabase = await createClient();

  // Checked here too, not just at verifyGuestCheckoutOtp — a locked account
  // otherwise still gets a real, live OTP email on every request even
  // though the verify step would correctly refuse it. No enumeration risk:
  // returns false uniformly for an email with no account (this call also
  // silently provisions one via shouldCreateUser below), so this reveals
  // nothing new either way.
  const isLocked = Boolean(
    await callLockoutRpc<boolean>(supabase, "is_account_locked", { p_email: email })
  );
  if (isLocked) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      data: { full_name: fullName, phone, guest_checkout: true },
    },
  });
  if (error) {
    return { error: authErrorMessage(error, "otp_send") };
  }

  return { step: "verify", email };
}

/**
 * Step 2: verifying the typed code establishes a real session in this same
 * request/tab (same shape as verifyPhoneOtp) — which is also the first
 * point a phone backfill can happen, since unlike a real signup there's no
 * /auth/callback in this flow to do it. Immediately continues into the
 * exact same purchaseServiceProduct() every logged-in purchase uses and
 * sends the guest straight to Paystack — nothing about checkout,
 * activation or RLS is guest-specific past this point.
 */
export async function verifyGuestCheckoutOtp(
  serviceProductCode: string,
  _prevState: GuestCheckoutState,
  formData: FormData
): Promise<GuestCheckoutState> {
  if (!isGuestCheckoutProductCode(serviceProductCode)) {
    return { error: "This isn't available without an account. Please sign in or sign up first." };
  }

  const parsed = guestCheckoutVerifySchema.safeParse({
    email: formData.get("email"),
    token: formData.get("token"),
  });
  if (!parsed.success) {
    return {
      ...firstIssue(parsed.error, "Check the code and try again."),
      step: "verify",
      email: formData.get("email")?.toString(),
    };
  }
  const { email, token } = parsed.data;

  // A 6-digit code is only 1M possibilities — without this, the request
  // step's own limit above doesn't stop someone brute-forcing a code
  // they've already been sent. Same limits as login-phone-verify.
  const limited = await checkAuthRateLimit(
    "guest-checkout-verify",
    email,
    { limit: 20, windowSeconds: 300 },
    { limit: 8, windowSeconds: 900 }
  );
  if (!limited.success) {
    return { error: RATE_LIMIT_MESSAGE, step: "verify", email };
  }

  const supabase = await createClient();

  // Reads the SAME account-level lockout the login flow enforces (see
  // 20260918111442_account_lockout_after_repeated_failed_logins.sql).
  // Without this, an account locked out by 5 failed PASSWORD attempts on
  // /login could still be fully authenticated through THIS flow instead —
  // signInWithOtp with shouldCreateUser:true (startGuestCheckout above)
  // silently signs in a returning guest whose email matches an existing
  // account, so a locked account is reachable here even though the login
  // page correctly refuses it. Best-effort, same posture as every other
  // lockout check in this codebase: a transient failure here must never
  // itself block a real checkout.
  const isLocked = Boolean(
    await callLockoutRpc<boolean>(supabase, "is_account_locked", { p_email: email })
  );
  if (isLocked) {
    return { error: RATE_LIMIT_MESSAGE, step: "verify", email };
  }

  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error || !data.user) {
    // Deliberately does NOT call record_failed_login here, unlike every
    // other verify path in this codebase — found and reverted before merge
    // as a real vulnerability this migration's own protection would have
    // introduced, not a missed spot. Every other lockout-writing entry point
    // (password, phone OTP) requires the caller to already know something
    // about the account (the password itself, or control of the phone
    // number the OTP was sent to) before a failure can even be attempted.
    // startGuestCheckout needs only a PUBLIC email address to trigger a real
    // OTP send to that address — so if wrong guesses here also counted
    // toward the shared lockout counter, any stranger who knows nothing else
    // about a victim's account could send them one OTP, submit 5 guesses
    // they can never actually get right (the code went to the victim's own
    // inbox), and lock the victim out of password AND phone-OTP login too —
    // repeatable indefinitely with nothing but a public email address as
    // input, worse than the bypass this lockout was built to close. The
    // is_account_locked READ above still closes the real bypass (a locked
    // account can't be reached via checkout); recording failures from this
    // specific entry point is intentionally left out. The existing
    // guest-checkout-verify rate limit (8/15min) above is this endpoint's
    // own, narrower protection against OTP brute-forcing.
    return { error: authErrorMessage(error, "otp_verify"), step: "verify", email };
  }

  // Best-effort — never let lockout bookkeeping block a real checkout.
  await callLockoutRpc(supabase, "clear_login_failures");

  // Same new-device security alert every real sign-in path fires (see
  // redirectAfterLogin in login/actions.ts) — found missing here in review.
  // This flow "silently authenticates a returning guest whose email matches
  // an EXISTING account" (this function's own doc comment above), so someone
  // who reaches an existing account through checkout — whether the real
  // owner or anyone who intercepted/guessed their OTP — deserves the same
  // "new sign-in from an unrecognized device" notification a password or
  // phone-OTP login would have triggered. Best-effort, never blocks a real
  // checkout (see record-login-device.ts).
  await recordLoginDevice(supabase);

  // Fresh timestamp for THIS session — see stampActivityCookie's own doc
  // comment for why inheriting a previous session's stale cookie would
  // otherwise bounce this guest straight to /login?reason=idle right after
  // authenticating.
  await stampActivityCookie();

  const metadataPhone = data.user.user_metadata?.phone;
  if (typeof metadataPhone === "string" && metadataPhone.length > 0) {
    await supabase.from("profiles").update({ phone: metadataPhone }).eq("id", data.user.id);
  }

  const result = await purchaseServiceProduct({
    serviceProductCode,
    callbackPath: "/checkout/receipt",
    client: supabase,
  });

  if (result?.error) return { error: result.error };
  if (result?.activated) redirect("/checkout/receipt");
  if (result?.checkoutUrl) redirect(result.checkoutUrl);
  return { error: "Could not start checkout. Please try again." };
}
