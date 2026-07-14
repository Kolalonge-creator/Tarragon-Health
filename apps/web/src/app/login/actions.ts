"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  emailLoginSchema,
  phoneOtpRequestSchema,
  phoneOtpVerifySchema,
} from "@/lib/validation/auth";
import { getRoleHomePath } from "@/lib/auth/roles";
import { sanitizeRedirect } from "@/lib/auth/redirect";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export type LoginActionState = { error?: string; step?: "verify"; phone?: string } | undefined;

async function redirectAfterLogin(
  supabase: SupabaseClient<Database>,
  userId: string,
  redirectTo: FormDataEntryValue | null
) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  const home = profile ? getRoleHomePath(profile.role) : "/patient";
  redirect(sanitizeRedirect(redirectTo?.toString()) ?? home);
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
