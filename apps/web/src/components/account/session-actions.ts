"use server";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { authErrorMessage } from "@/lib/auth/auth-error-message";

export type SignOutOthersState = { success?: boolean; error?: string } | undefined;

/**
 * Revokes every OTHER active session for this account (other devices and
 * browsers) without touching the session making this request. Uses Supabase
 * Auth's `others` sign-out scope — confirmed present in the pinned
 * @supabase/supabase-js@2.110.0 (auth-js's types.d.ts declares
 * `scope?: 'global' | 'local' | 'others'` on SignOut options). This is a
 * read/write account-security action, not an MFA one, so it lives alongside
 * mfa-actions.ts rather than inside it.
 */
export async function signOutOtherSessions(
  _prevState: SignOutOthersState,
  _formData: FormData
): Promise<SignOutOthersState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session has expired. Sign in again, then retry." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) {
    return { error: authErrorMessage(error, "sign_out_others") };
  }
  return { success: true };
}
