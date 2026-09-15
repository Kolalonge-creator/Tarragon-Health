"use server";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { newPasswordSchema } from "@/lib/validation/auth";
import { authErrorMessage } from "@/lib/auth/auth-error-message";
import { firstIssue } from "@/lib/validation/first-issue";

export type UpdateOwnPasswordState =
  | { error?: string; field?: string; success?: boolean }
  | undefined;

/** Changes the signed-in caller's own password from inside the dashboard —
 * distinct from /reset-password, which runs against a recovery session
 * reached via an emailed link and has no logged-in user yet. Shared by every
 * role's own profile surface (patient's /patient/profile, everyone else's
 * /account), not just one route, so it lives outside any single route
 * segment. */
export async function updateOwnPassword(
  _prevState: UpdateOwnPasswordState,
  formData: FormData
): Promise<UpdateOwnPasswordState> {
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return firstIssue(parsed.error, "Check the password and try again.");
  }

  const user = await getCurrentUser();
  if (!user) {
    return { error: "Your session has expired. Sign in again, then retry." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { error: authErrorMessage(error, "password_update"), field: "password" };
  }
  return { success: true };
}
