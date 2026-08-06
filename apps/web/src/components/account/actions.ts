"use server";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { newPasswordSchema } from "@/lib/validation/auth";

export type UpdateOwnPasswordState = { error?: string; success?: boolean } | undefined;

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
    return { error: parsed.error.issues[0]?.message ?? "Invalid password" };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { error: error.message };
  }
  return { success: true };
}
