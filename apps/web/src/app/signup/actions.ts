"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { signupSchema } from "@/lib/validation/auth";
import { checkAuthRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { authErrorMessage } from "@/lib/auth/auth-error-message";
import { firstIssue } from "@/lib/validation/first-issue";

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

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
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

  return { success: true };
}
