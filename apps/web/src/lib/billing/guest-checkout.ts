"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { purchaseServiceProduct } from "@/lib/billing/purchase-service-product";
import { isGuestCheckoutProductCode } from "@/lib/billing/guest-checkout-products";
import {
  guestCheckoutSchema,
  guestCheckoutVerifySchema,
  combineGuestPhone,
} from "@/lib/validation/guest-checkout";
import { checkAuthRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { authErrorMessage, isInvalidOtpError } from "@/lib/auth/auth-error-message";
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
  let isLocked = false;
  try {
    const result = await supabase.rpc("is_account_locked", { p_email: email });
    isLocked = Boolean(result.data);
  } catch {
    // Fall through and let signInWithOtp decide.
  }
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

  // Same real account-level lockout the login flow enforces (see
  // 20260918111442_account_lockout_after_repeated_failed_logins.sql).
  // Without this, an account locked out by 5 failed PASSWORD attempts on
  // /login could still be fully authenticated through THIS flow instead —
  // signInWithOtp with shouldCreateUser:true (startGuestCheckout above)
  // silently signs in a returning guest whose email matches an existing
  // account, so a locked account is reachable here even though the login
  // page correctly refuses it. Best-effort, same posture as every other
  // lockout check in this codebase: a transient failure here must never
  // itself block a real checkout.
  let isLocked = false;
  try {
    const result = await supabase.rpc("is_account_locked", { p_email: email });
    isLocked = Boolean(result.data);
  } catch {
    // Fall through and let verifyOtp decide.
  }
  if (isLocked) {
    return { error: RATE_LIMIT_MESSAGE, step: "verify", email };
  }

  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error || !data.user) {
    // Only a genuine wrong/expired code counts toward the lockout — never a
    // rate-limit or network error. Service-role-only, same reasoning as
    // login/actions.ts: the anon key is not a secret.
    if (isInvalidOtpError(error)) {
      try {
        await createServiceRoleClient().rpc("record_failed_login", { p_email: email });
      } catch {
        // Never let lockout bookkeeping block showing the real error.
      }
    }
    return { error: authErrorMessage(error, "otp_verify"), step: "verify", email };
  }

  // Best-effort — never let lockout bookkeeping block a real checkout.
  try {
    await supabase.rpc("clear_login_failures");
  } catch {
    // Never let lockout bookkeeping block a real checkout.
  }

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
