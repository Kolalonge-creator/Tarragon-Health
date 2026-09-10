"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isGuestCheckoutProductCode } from "@/lib/billing/guest-checkout-products";
import { guestCheckoutSchema, combineGuestPhone } from "@/lib/validation/guest-checkout";
import { checkAuthRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { authErrorMessage } from "@/lib/auth/auth-error-message";
import { firstIssue } from "@/lib/validation/first-issue";

export type GuestCheckoutState = { error?: string; field?: string; sent?: boolean } | undefined;

/**
 * Starts buying a paid service for someone with no Tarragon account — by
 * emailing them a real magic link, the same way any passwordless sign-in
 * works, rather than establishing a session for them silently.
 *
 * This deliberately does NOT use the service-role client or
 * admin.createUser/admin.generateLink: signInWithOtp with
 * shouldCreateUser:true is the documented, already-used-elsewhere (phone
 * login/reset use the phone equivalent) way to both provision an account
 * and send someone a real sign-in link in one call — it silently no-ops
 * into "send an existing user a login link" if the email is already
 * registered, so a returning guest is handled identically with no special
 * branch needed here.
 *
 * `data` here becomes the new user's user_metadata exactly like signUp's
 * `options.data` does (apps/web/src/app/signup/actions.ts) — full_name and
 * phone both flow through to /auth/callback's existing backfill (it already
 * reads user_metadata.phone into profiles.phone; nothing new needed there).
 *
 * The product code travels through emailRedirectTo's `redirect` query param
 * (the same param /auth/callback already reads via sanitizeRedirect for
 * "come back to where you meant to go"), landing on /checkout/continue
 * once the link is clicked and a session exists — that page is what
 * actually calls purchaseServiceProduct() and sends the guest on to
 * Paystack. No server-side state to store or expire in the meantime.
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

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const continuePath = `/checkout/continue?code=${encodeURIComponent(serviceProductCode)}`;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${origin}/auth/callback?redirect=${encodeURIComponent(continuePath)}`,
      data: { full_name: fullName, phone, guest_checkout: true },
    },
  });
  if (error) {
    return { error: authErrorMessage(error, "otp_send") };
  }

  return { sent: true };
}
