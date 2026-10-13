"use server";

import * as Sentry from "@sentry/nextjs";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { checkAuthRateLimit } from "@/lib/rate-limit";
import { authErrorKey } from "@tarragon/auth/auth-error-key";
import { t } from "@tarragon/i18n";
import { getAuthLocale } from "@/lib/auth/auth-locale";
import { e164FromAuthPhone, phoneChangeOptions } from "@/lib/account/phone-change-options";

export type PhoneChangeConfirmState =
  | { error?: string; field?: string; step?: "code"; method?: "old_phone" | "email"; confirmed?: boolean; at?: number }
  | undefined;

function readMethod(formData: FormData): "old_phone" | "email" | null {
  const m = formData.get("method");
  return m === "old_phone" || m === "email" ? m : null;
}

/**
 * Step 0 of changing the sign-in number (S03b, closes the confirmation half of OQ-43): before a NEW number can even be asked
 * for, the owner proves control of the CURRENT number or the VERIFIED email with a 6-digit code. Only a code to a confirmed
 * channel is ever sent, and the address or number comes from Auth, never from the form. Codes to the phone go through the
 * normal Send SMS hook (code-only, INV-08); the email route works with no phone at all.
 */
export async function sendPhoneChangeConfirmationCode(
  _prevState: PhoneChangeConfirmState,
  formData: FormData,
): Promise<PhoneChangeConfirmState> {
  const locale = await getAuthLocale();
  const method = readMethod(formData);
  const user = await getCurrentUser();
  if (!user || !method) return { error: t("auth.error.sign_in_failed", locale) };

  const options = phoneChangeOptions(user);
  if ((method === "old_phone" && !options.oldPhone) || (method === "email" && !options.email)) {
    return { error: t("auth.phone_change.no_route", locale) };
  }

  const limited = await checkAuthRateLimit(
    "phone-change-confirm",
    user.id,
    { limit: 10, windowSeconds: 3600 },
    { limit: 4, windowSeconds: 3600 },
  );
  if (!limited.success) return { error: t("auth.error.rate_limited", locale), method };

  const supabase = await createClient();
  const { error } =
    method === "old_phone"
      ? await supabase.auth.signInWithOtp({ phone: e164FromAuthPhone(user.phone as string), options: { shouldCreateUser: false } })
      : await supabase.auth.signInWithOtp({ email: user.email as string, options: { shouldCreateUser: false } });
  if (error) return { error: t(authErrorKey(error, "otp_send"), locale), method };
  return { step: "code", method };
}

/**
 * Step 0b: the code is checked by Auth; only when it is right does the SERVER (service role, never the browser) record a
 * 15-minute, single-use authorisation for this account. The database refuses a number change that has none, even if someone
 * calls Auth directly with a stolen access token, so this action is where the authorisation is earned, not where it is enforced.
 */
export async function confirmPhoneChangeIdentity(
  _prevState: PhoneChangeConfirmState,
  formData: FormData,
): Promise<PhoneChangeConfirmState> {
  const locale = await getAuthLocale();
  const method = readMethod(formData);
  const token = String(formData.get("token") ?? "").replace(/\s/g, "");
  const user = await getCurrentUser();
  if (!user || !method) return { error: t("auth.error.sign_in_failed", locale) };
  if (!/^\d{6}$/.test(token)) return { error: t("auth.error.wrong_code", locale), field: "token", step: "code", method };

  const options = phoneChangeOptions(user);
  if ((method === "old_phone" && !options.oldPhone) || (method === "email" && !options.email)) {
    return { error: t("auth.phone_change.no_route", locale) };
  }

  const limited = await checkAuthRateLimit(
    "phone-change-confirm-verify",
    user.id,
    { limit: 20, windowSeconds: 300 },
    { limit: 8, windowSeconds: 900 },
  );
  if (!limited.success) return { error: t("auth.error.rate_limited", locale), step: "code", method };

  const supabase = await createClient();
  const { data, error } =
    method === "old_phone"
      ? await supabase.auth.verifyOtp({ phone: e164FromAuthPhone(user.phone as string), token, type: "sms" })
      : await supabase.auth.verifyOtp({ email: user.email as string, token, type: "email" });
  // The code must belong to THIS account: a code that signs in somebody else proves nothing about the person asking.
  if (error || !data.user || data.user.id !== user.id) {
    return { error: t(authErrorKey(error, "otp_verify"), locale), field: "token", step: "code", method };
  }

  const svc = createServiceRoleClient();
  const { data: out, error: rpcError } = await svc.rpc("authorise_phone_change", { p_user: user.id, p_method: method });
  if (rpcError || (out as { ok?: boolean } | null)?.ok !== true) {
    Sentry.captureMessage("phone change: authorisation could not be recorded", "error");
    return { error: t("auth.error.generic", locale), step: "code", method };
  }
  return { confirmed: true, at: Date.now() };
}
