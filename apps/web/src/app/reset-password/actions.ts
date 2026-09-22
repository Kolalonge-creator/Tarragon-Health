"use server";

import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { newPasswordSchema } from "@/lib/validation/auth";
import { getRoleHomePath } from "@/lib/auth/roles";
import { authErrorMessage } from "@/lib/auth/auth-error-message";
import { firstIssue } from "@/lib/validation/first-issue";

export type ResetPasswordActionState = { error?: string; field?: string } | undefined;

export async function updatePassword(
  _prevState: ResetPasswordActionState,
  formData: FormData
): Promise<ResetPasswordActionState> {
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return firstIssue(parsed.error, "Check the password and try again.");
  }

  const user = await getCurrentUser();
  if (!user) {
    return { error: "Your reset session has expired. Please request a new reset link or code." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { error: authErrorMessage(error, "password_update"), field: "password" };
  }

  // Same as verifyPhoneReset's success path (forgot-password/actions.ts) —
  // without this, a patient who was locked out after 5 wrong passwords,
  // then reset via the emailed link (proving ownership and setting a valid
  // new password), stays locked: is_account_locked() would still refuse
  // their brand-new correct password for up to 15 more minutes if their
  // reset session ends before the lock naturally expires. Best-effort —
  // never let lockout bookkeeping block a real password reset.
  try {
    await supabase.rpc("clear_login_failures");
  } catch {
    // Never let lockout bookkeeping block a real password reset.
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  redirect(profile ? getRoleHomePath(profile.role) : "/patient");
}
