"use server";

import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { newPasswordSchema } from "@/lib/validation/auth";
import { getRoleHomePath } from "@/lib/auth/roles";

export type ResetPasswordActionState = { error?: string } | undefined;

export async function updatePassword(
  _prevState: ResetPasswordActionState,
  formData: FormData
): Promise<ResetPasswordActionState> {
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid password" };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { error: "Your reset session has expired. Please request a new reset link or code." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { error: error.message };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  redirect(profile ? getRoleHomePath(profile.role) : "/patient");
}
