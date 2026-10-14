"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { redirectAfterLogin } from "@/lib/auth/redirect-after-login";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import {
  askRecoveryContact,
  recoverWithBackupCode,
  sendContactRecoveryLink,
  type RecoveryLinkSender,
} from "@/lib/auth/recovery/recovery-routes";
import { t } from "@tarragon/i18n";
import { getAuthLocale } from "@/lib/auth/auth-locale";

export type RecoveryActionState =
  | { error?: string; field?: string; success?: boolean; message?: string }
  | undefined;

/**
 * Recovery with a backup code (S03b). The person types their email or phone number, one backup code and a new password.
 * The code is single use; the password is set by the server only after the code checks out; every other session of the
 * account is ended; the owner is told in-app and by email. Then they are signed in with the new password.
 *
 * Every failure of the code or the identifier reads the same, so this form cannot be used to learn who has an account.
 */
export async function recoverWithBackupCodeAction(
  _prevState: RecoveryActionState,
  formData: FormData,
): Promise<RecoveryActionState> {
  const locale = await getAuthLocale();
  const password = String(formData.get("password") ?? "");
  if (password !== String(formData.get("confirmPassword") ?? "")) {
    return { error: t("auth.password.mismatch", locale), field: "confirmPassword" };
  }

  const result = await recoverWithBackupCode({
    identifier: String(formData.get("identifier") ?? ""),
    code: String(formData.get("code") ?? ""),
    newPassword: password,
  });

  if (!result.ok) {
    if (result.reason === "rate_limited") return { error: RATE_LIMIT_MESSAGE };
    if (result.reason === "weak_password") return { error: result.message, field: "password" };
    if (result.reason === "unavailable") return { error: t("auth.error.generic", locale) };
    return { error: t("auth.recovery.backup_failed", locale), field: "code" };
  }

  // The password is changed. Sign them in with it; if that cannot happen right now they can still sign in by hand.
  const supabase = await createClient();
  const { data, error } =
    result.signInWith.kind === "email"
      ? await supabase.auth.signInWithPassword({ email: result.signInWith.value, password })
      : await supabase.auth.signInWithPassword({ phone: result.signInWith.value, password });
  if (error || !data.user) {
    return { success: true, message: t("auth.recovery.backup_done", locale) };
  }
  await redirectAfterLogin(supabase, data.user.id, null);
}

async function webSender(): Promise<RecoveryLinkSender> {
  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL;
  const supabase = await createClient();
  return {
    email: (address) => supabase.auth.resetPasswordForEmail(address, { redirectTo: `${origin}/reset-password` }),
    // shouldCreateUser:false: asking for a code must never create an account.
    phoneCode: (phone) => supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } }),
  };
}

/** Step 1 of the recovery-contact route: ask the contact the person named in their Care Circle. The answer is always the same. */
export async function askRecoveryContactAction(
  _prevState: RecoveryActionState,
  formData: FormData,
): Promise<RecoveryActionState> {
  const locale = await getAuthLocale();
  const result = await askRecoveryContact(String(formData.get("identifier") ?? ""));
  if (!result.ok) {
    if (result.reason === "rate_limited") return { error: RATE_LIMIT_MESSAGE };
    if (result.reason === "invalid_input") return { error: t("auth.error.invalid_phone", locale), field: "identifier" };
    return { error: t("auth.error.generic", locale) };
  }
  return { success: true, message: t("auth.recovery.contact_asked", locale) };
}

/** Step 2: once the contact has confirmed and the wait is over, send the one-time link to the person's own verified channel. */
export async function sendContactRecoveryLinkAction(
  _prevState: RecoveryActionState,
  formData: FormData,
): Promise<RecoveryActionState> {
  const locale = await getAuthLocale();
  const result = await sendContactRecoveryLink(String(formData.get("identifier") ?? ""), await webSender());
  if (!result.ok) {
    if (result.reason === "rate_limited") return { error: RATE_LIMIT_MESSAGE };
    if (result.reason === "invalid_input") return { error: t("auth.error.invalid_phone", locale), field: "identifier" };
    return { error: t("auth.error.generic", locale) };
  }
  return { success: true, message: t("auth.recovery.contact_sent", locale) };
}
