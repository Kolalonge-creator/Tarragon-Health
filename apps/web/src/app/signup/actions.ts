"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { signupSchema } from "@/lib/validation/auth";
import { checkAuthRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { authErrorMessage } from "@/lib/auth/auth-error-message";
import { firstIssue } from "@/lib/validation/first-issue";
import { sanitizeRedirect } from "@/lib/auth/redirect";
import { redirectAfterLogin } from "@/lib/auth/redirect-after-login";
import { backfillSignupMetadata } from "@/lib/auth/backfill-signup-metadata";
import { runBestEffort } from "@/lib/sentry/run-best-effort";

export type SignupActionState =
  | { error?: string; field?: string; success?: boolean }
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
    // silently never be applied. Best-effort: the account and session
    // already exist by this point, so a transport error redeeming a
    // referral code must not turn a successful signup into an error page.
    await runBestEffort(() => backfillSignupMetadata(supabase, user), {
      action: "signUp",
      stage: "metadata_backfill",
      userId: user.id,
    });
    await redirectAfterLogin(supabase, user.id, redirectTo);
  }

  return { success: true };
}
