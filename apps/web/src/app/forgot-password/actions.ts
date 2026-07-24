"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  passwordResetEmailSchema,
  phoneOtpRequestSchema,
  phoneOtpVerifySchema,
} from "@/lib/validation/auth";

export type ForgotPasswordActionState =
  | { error?: string; success?: boolean; step?: "verify"; phone?: string }
  | undefined;

/** Sends a password-reset link to the given email via Supabase Auth. */
export async function requestPasswordResetEmail(
  _prevState: ForgotPasswordActionState,
  formData: FormData
): Promise<ForgotPasswordActionState> {
  const parsed = passwordResetEmailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a valid email" };
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL;
  const supabase = await createClient();
  // Supabase never reveals whether the email is registered — this always
  // "succeeds" client-side even for an unknown address, which is the
  // intended anti-enumeration behaviour, so a generic success message is
  // shown regardless (errors here are transport/rate-limit failures only).
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?redirect=${encodeURIComponent("/reset-password")}`,
  });
  if (error) {
    return { error: "Could not send reset email. Please try again." };
  }

  return { success: true };
}

/** Phone-side of forgot-password reuses the same OTP flow as phone login. */
export async function requestPhoneReset(
  _prevState: ForgotPasswordActionState,
  formData: FormData
): Promise<ForgotPasswordActionState> {
  const parsed = phoneOtpRequestSchema.safeParse({
    countryCode: formData.get("countryCode"),
    phone: formData.get("phone"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid phone number" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ phone: parsed.data.phone });
  if (error) {
    return { error: error.message };
  }

  return { step: "verify", phone: parsed.data.phone };
}

/**
 * Verifying the code establishes a real session (same as phone login) —
 * that session is what lets /reset-password call auth.updateUser().
 */
export async function verifyPhoneReset(
  _prevState: ForgotPasswordActionState,
  formData: FormData
): Promise<ForgotPasswordActionState> {
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

  redirect("/reset-password");
}
