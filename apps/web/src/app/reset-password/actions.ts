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

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  redirect(profile ? getRoleHomePath(profile.role) : "/patient");
}
