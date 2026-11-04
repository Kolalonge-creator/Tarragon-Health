"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { phoneOtpRequestSchema } from "@/lib/validation/auth";
import { firstIssue } from "@/lib/validation/first-issue";

export type SavePhoneState = { error?: string; field?: string; success?: boolean } | undefined;

/**
 * The phone step of onboarding (2026-11-04, Google sign-in). Email and phone sign-up both collect a phone number; a Google sign-up
 * does not, so onboarding asks for it before anything else. Stored in E.164 (profiles_phone_e164 also checks the shape). Like the
 * email sign-up's phone, it is not verified here; the phone sign-in route verifies a number when someone chooses to use it.
 */
export async function savePhone(_prev: SavePhoneState, formData: FormData): Promise<SavePhoneState> {
  const parsed = phoneOtpRequestSchema.safeParse({ countryCode: formData.get("countryCode"), phone: formData.get("phone") });
  if (!parsed.success) return firstIssue(parsed.error, "Enter a valid phone number for the selected country");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.from("profiles").update({ phone: parsed.data.phone }).eq("id", user.id);
  if (error) return { error: "We could not save that just then. Please try again." };
  return { success: true };
}
