"use server";

import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { newPasswordSchema } from "@/lib/validation/auth";
import { getRoleHomePath } from "@/lib/auth/roles";
import { authErrorMessage } from "@/lib/auth/auth-error-message";
import { firstIssue } from "@/lib/validation/first-issue";
import { checkNewPassword } from "@/lib/auth/check-new-password";

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

  // Length is already checked above; this adds the breached-password range check (only a 5-character hash
  // prefix leaves the server). It fails open if the range service is down, see packages/auth/src/breached-password.ts.
  const verdict = await checkNewPassword(parsed.data.password);
  if (!verdict.ok) {
    return { error: verdict.message, field: "password" };
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  redirect(profile ? getRoleHomePath(profile.role) : "/patient");
}
