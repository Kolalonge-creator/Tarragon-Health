"use server";

import * as Sentry from "@sentry/nextjs";
import { createClient as createStatelessClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { getAuthLocale } from "@/lib/auth/auth-locale";
import { checkNewPassword } from "@/lib/auth/check-new-password";
import { checkAuthRateLimit } from "@/lib/rate-limit";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation/password";
import { proxyConfirmSchema, proxyDeclineSchema, proxySetupSchema } from "@/lib/validation/proxy-setup";
import { getProposedConfig } from "@tarragon/shared";
import { t } from "@tarragon/i18n";

export type ProxySetupState = { error?: string; sent?: boolean; hours?: number } | undefined;
export type ProxyConfirmState = { error?: string; done?: "confirmed" | "declined"; name?: string; passwordError?: string } | undefined;

type ProxySetupConfig = { ttlHours: number; maxPerDay: number };

/**
 * "Set up for my parent" (v5 8.2, function 1.19). Records the setup, then asks Auth to text a verification code to the
 * PARENT's number. Nothing here lets the proxy see anything about the parent: access is created only by the parent's
 * own confirm_proxy_setup call, after they sign in with that code on their own phone (safety case 23).
 *
 * The answer never depends on whether the number already has an account: the code goes to its holder either way
 * (signInWithOtp creates the account if needed, or signs the existing holder in), and the proxy gets the same message.
 */
export async function startProxySetupAction(_prev: ProxySetupState, formData: FormData): Promise<ProxySetupState> {
  const locale = await getAuthLocale();
  const parsed = proxySetupSchema.safeParse({
    fullName: formData.get("fullName"),
    countryCode: formData.get("countryCode"),
    phone: formData.get("phone"),
  });
  if (!parsed.success) return { error: t("proxy.setup.error.invalid", locale) };

  const profile = await getCurrentProfile();
  if (!profile) return { error: t("proxy.setup.error.invalid", locale) };

  // Every setup costs a verification-code SMS, so the number is limited as well as the caller.
  // Keyed on the caller AND the number: a limit on the number alone lets anyone use up a stranger's budget.
  const limited = await checkAuthRateLimit(
    "proxy-setup",
    `${profile.id}:${parsed.data.phone}`,
    { limit: 10, windowSeconds: 3600 },
    { limit: 3, windowSeconds: 3600 }
  );
  if (!limited.success) return { error: t("proxy.setup.error.rate_limited", locale) };

  const config = getProposedConfig<ProxySetupConfig>("proxy.setup").value;
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_proxy_setup", {
    p_full_name: parsed.data.fullName,
    p_phone: parsed.data.phone,
    p_ttl_hours: config.ttlHours,
    p_max_per_day: config.maxPerDay,
  });
  if (error) {
    if (error.message.includes("proxy_setup_rate_limited")) return { error: t("proxy.setup.error.rate_limited", locale) };
    if (error.message.includes("your own number")) return { error: t("proxy.setup.error.own_number", locale) };
    Sentry.captureMessage("create_proxy_setup rejected", { level: "warning", tags: { pg_code: error.code ?? "none" } });
    return { error: t("proxy.setup.error.invalid", locale) };
  }

  // A stateless client: this must never read or write the proxy's own session cookies.
  const sender = createStatelessClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: otpError } = await sender.auth.signInWithOtp({
    phone: parsed.data.phone,
    options: { shouldCreateUser: true },
  });
  if (otpError) {
    // Never report success when no code went out (the SMS provider can be unset or capped): the proxy would wait for
    // a parent who has nothing to enter. The setup row exists, so trying again returns it and sends a fresh code. The
    // message is the same for every number, so it tells the proxy nothing about the number itself.
    Sentry.captureMessage("proxy setup code not sent", {
      level: "warning",
      tags: { auth_code: String((otpError as { code?: unknown }).code ?? "none"), auth_status: String((otpError as { status?: unknown }).status ?? "none") },
    });
    return { error: t("proxy.setup.error.not_sent", locale) };
  }

  revalidatePath("/patient/family");
  return { sent: true, hours: config.ttlHours };
}

/**
 * The parent's answer, from their own signed-in session. The caller's identity is whatever Auth says it is; nothing
 * about who is confirming comes from the form. The categories are the only thing the parent chooses.
 */
export async function confirmProxySetupAction(_prev: ProxyConfirmState, formData: FormData): Promise<ProxyConfirmState> {
  const locale = await getAuthLocale();
  const parsed = proxyConfirmSchema.safeParse({
    setupId: formData.get("setupId"),
    categories: formData.getAll("categories"),
    password: formData.get("password")?.toString() || undefined,
  });
  if (!parsed.success) return { error: t("proxy.confirm.error", locale) };
  const name = formData.get("requesterName")?.toString().slice(0, 100) ?? "";

  // Validate the optional password BEFORE confirming, so a rejected password cannot leave a half-done state.
  if (parsed.data.password) {
    const verdict = await checkNewPassword(parsed.data.password);
    if (!verdict.ok) {
      return {
        passwordError:
          verdict.reason === "breached" ? t("auth.password.breached", locale, { min: PASSWORD_MIN_LENGTH }) : verdict.message,
      };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_proxy_setup", {
    p_setup_id: parsed.data.setupId,
    p_categories: parsed.data.categories,
    p_permissions: [],
  });
  if (error) return { error: t("proxy.confirm.error", locale) };

  let passwordError: string | undefined;
  if (parsed.data.password) {
    const { error: pwError } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (pwError) {
      Sentry.captureMessage("parent password not saved after proxy confirm", { level: "warning" });
      passwordError = t("auth.error.generic", locale);
    }
  }

  revalidatePath("/patient");
  return { done: "confirmed", name, passwordError };
}

export async function declineProxySetupAction(_prev: ProxyConfirmState, formData: FormData): Promise<ProxyConfirmState> {
  const locale = await getAuthLocale();
  const parsed = proxyDeclineSchema.safeParse({ setupId: formData.get("setupId") });
  if (!parsed.success) return { error: t("proxy.confirm.error", locale) };
  const name = formData.get("requesterName")?.toString().slice(0, 100) ?? "";
  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_proxy_setup", { p_setup_id: parsed.data.setupId });
  if (error) return { error: t("proxy.confirm.error", locale) };
  revalidatePath("/patient");
  return { done: "declined", name };
}
