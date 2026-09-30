"use server";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { newPasswordSchema, phoneOtpRequestSchema, phoneOtpVerifySchema } from "@/lib/validation/auth";
import { authErrorMessage } from "@/lib/auth/auth-error-message";
import { firstIssue } from "@/lib/validation/first-issue";
import { checkAuthRateLimit } from "@/lib/rate-limit";
import { authErrorKey } from "@tarragon/auth/auth-error-key";
import { t } from "@tarragon/i18n";
import { getAuthLocale } from "@/lib/auth/auth-locale";
import { checkPasswordAcceptable } from "@tarragon/auth/password-check";

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

  // Length is already checked above; this adds the breached-password range check (only a 5-character hash
  // prefix leaves the server). It fails open if the range service is down, see packages/auth/src/breached-password.ts.
  const verdict = await checkPasswordAcceptable(parsed.data.password);
  if (!verdict.ok) {
    return { error: verdict.message, field: "password" };
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

export type ChangePhoneState =
  | { error?: string; field?: string; step?: "verify"; phone?: string; success?: boolean }
  | undefined;

/**
 * Step 1 of changing the phone number (S03, function 1.2: "re-verified whenever the number changes"). Asks Auth to
 * move the account to the new number; Auth sends a six-digit code to the NEW number through the Send SMS hook and
 * changes nothing until that code is entered. The old number stays in force meanwhile.
 */
export async function requestPhoneChange(
  _prevState: ChangePhoneState,
  formData: FormData
): Promise<ChangePhoneState> {
  const locale = await getAuthLocale();
  const parsed = phoneOtpRequestSchema.safeParse({
    countryCode: formData.get("countryCode"),
    phone: formData.get("phone"),
  });
  if (!parsed.success) {
    return { error: t("auth.error.invalid_phone", locale), field: "phone" };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { error: t("auth.error.sign_in_failed", locale) };
  }
  if (user.phone && `+${user.phone.replace(/^\+/, "")}` === parsed.data.phone) {
    return { error: t("auth.phone_change.same", locale), field: "phone" };
  }

  // Every request costs an SMS, so this is keyed on the account as well as the number.
  const limited = await checkAuthRateLimit(
    "phone-change",
    user.id,
    { limit: 10, windowSeconds: 3600 },
    { limit: 3, windowSeconds: 3600 }
  );
  if (!limited.success) {
    return { error: t("auth.error.rate_limited", locale) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ phone: parsed.data.phone });
  if (error) {
    return { error: t(authErrorKey(error, "otp_send"), locale), field: "phone" };
  }
  return { step: "verify", phone: parsed.data.phone };
}

/** Step 2: the code proves control of the new number; only then is the stored profile number updated. */
export async function confirmPhoneChange(
  _prevState: ChangePhoneState,
  formData: FormData
): Promise<ChangePhoneState> {
  const locale = await getAuthLocale();
  const parsed = phoneOtpVerifySchema.safeParse({
    phone: formData.get("phone"),
    token: formData.get("token"),
  });
  if (!parsed.success) {
    return { error: t("auth.error.wrong_code", locale), field: "token", step: "verify", phone: formData.get("phone")?.toString() };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { error: t("auth.error.sign_in_failed", locale) };
  }

  const limited = await checkAuthRateLimit(
    "phone-change-verify",
    user.id,
    { limit: 20, windowSeconds: 300 },
    { limit: 8, windowSeconds: 900 }
  );
  if (!limited.success) {
    return { error: t("auth.error.rate_limited", locale), step: "verify", phone: parsed.data.phone };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    phone: parsed.data.phone,
    token: parsed.data.token,
    type: "phone_change",
  });
  if (error) {
    return { error: t(authErrorKey(error, "otp_verify"), locale), field: "token", step: "verify", phone: parsed.data.phone };
  }

  const { error: profileError } = await supabase.from("profiles").update({ phone: parsed.data.phone }).eq("id", user.id);
  if (profileError) {
    return { error: t("auth.error.generic", locale), step: "verify", phone: parsed.data.phone };
  }
  return { success: true };
}
