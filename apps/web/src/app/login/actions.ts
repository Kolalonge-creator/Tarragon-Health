"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  emailLoginSchema,
  phoneOtpRequestSchema,
  phoneOtpVerifySchema,
} from "@/lib/validation/auth";
import { resolveLoginDestination } from "@/lib/auth/redirect-after-login";
import { recordLoginDevice } from "@/lib/auth/record-login-device";
import { checkAuthRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export type LoginActionState = { error?: string; step?: "verify"; phone?: string } | undefined;

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
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
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
    return { error: error?.message ?? "Could not sign in" };
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
    return { error: parsed.error.issues[0]?.message ?? "Invalid phone number" };
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
    return { error: error.message };
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
      error: parsed.error.issues[0]?.message ?? "Invalid code",
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
      error: error?.message ?? "Could not verify code",
      step: "verify",
      phone: parsed.data.phone,
    };
  }

  await redirectAfterLogin(supabase, data.user.id, formData.get("redirectTo"));
}
