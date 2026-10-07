"use server";

import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { checkAuthRateLimit } from "@/lib/rate-limit";
import { authErrorKey } from "@tarragon/auth/auth-error-key";
import { t } from "@tarragon/i18n";
import { getAuthLocale } from "@/lib/auth/auth-locale";

/**
 * Forgotten PIN recovery for a private section (S66): the person proves they still hold the account's own phone (or, for an account with
 * no phone, its email) with a one-time code, and only then does the page delete its LOCAL lock record and ask for a new PIN.
 *
 * The PIN guards a view on this device, never server data, so nothing is read, changed or lost on the server by recovering. This action
 * never touches a health row. It never reveals the phone number or email it sent to, and it cannot be used to sign in as someone else:
 * the code is sent to the signed-in account's own contact and the verified user must be that same account.
 */

export type PrivateSectionRecoveryState =
  | { step?: "code"; sentTo?: "phone" | "email"; error?: string; success?: boolean }
  | undefined;

const codeSchema = z.object({ token: z.string().regex(/^\d{6}$/) });

function contactOf(user: { phone?: string | null; email?: string | null }): { kind: "phone"; value: string } | { kind: "email"; value: string } | null {
  if (user.phone) return { kind: "phone", value: `+${user.phone.replace(/^\+/, "")}` };
  if (user.email) return { kind: "email", value: user.email };
  return null;
}

export async function requestPrivateSectionRecoveryCode(): Promise<PrivateSectionRecoveryState> {
  const locale = await getAuthLocale();
  const user = await getCurrentUser();
  if (!user) return { error: t("auth.error.sign_in_failed", locale) };
  const contact = contactOf(user);
  if (!contact) return { error: t("auth.error.generic", locale) };

  // Every request can cost an SMS, so it is limited per account as well as per source.
  const limited = await checkAuthRateLimit("private-section-recovery", user.id, { limit: 10, windowSeconds: 3600 }, { limit: 3, windowSeconds: 3600 });
  if (!limited.success) return { error: t("auth.error.rate_limited", locale) };

  const supabase = await createClient();
  const { error } =
    contact.kind === "phone"
      ? await supabase.auth.signInWithOtp({ phone: contact.value, options: { shouldCreateUser: false } })
      : await supabase.auth.signInWithOtp({ email: contact.value, options: { shouldCreateUser: false } });
  if (error) return { error: t(authErrorKey(error, "otp_send"), locale) };
  return { step: "code", sentTo: contact.kind };
}

export async function verifyPrivateSectionRecoveryCode(
  _prev: PrivateSectionRecoveryState,
  formData: FormData,
): Promise<PrivateSectionRecoveryState> {
  const locale = await getAuthLocale();
  const parsed = codeSchema.safeParse({ token: String(formData.get("token") ?? "").replace(/\s/g, "") });
  if (!parsed.success) return { step: "code", error: t("auth.error.wrong_code", locale) };
  const user = await getCurrentUser();
  if (!user) return { error: t("auth.error.sign_in_failed", locale) };
  const contact = contactOf(user);
  if (!contact) return { error: t("auth.error.generic", locale) };

  const limited = await checkAuthRateLimit("private-section-recovery-verify", user.id, { limit: 20, windowSeconds: 300 }, { limit: 8, windowSeconds: 900 });
  if (!limited.success) return { step: "code", error: t("auth.error.rate_limited", locale) };

  const supabase = await createClient();
  const { data, error } =
    contact.kind === "phone"
      ? await supabase.auth.verifyOtp({ phone: contact.value, token: parsed.data.token, type: "sms" })
      : await supabase.auth.verifyOtp({ email: contact.value, token: parsed.data.token, type: "email" });
  if (error) return { step: "code", error: t(authErrorKey(error, "otp_verify"), locale) };
  // The code went to this account's own contact, so the verified user must be this account. Anything else is refused.
  if (data?.user && data.user.id !== user.id) return { error: t("auth.error.generic", locale) };
  return { success: true };
}
