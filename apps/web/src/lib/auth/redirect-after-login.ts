import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { getRoleHomePath } from "./roles";
import { sanitizeRedirect } from "./redirect";
import { recordLoginDevice } from "./record-login-device";

/**
 * Where a just-authenticated user should land: the sanitized intended
 * destination if there is one, otherwise their role home. Shared by the
 * password/phone login actions and the MFA challenge action so both resolve
 * the same way — plain (non-"use server") so it can take a SupabaseClient
 * argument, which a Server Action export can't (arguments must be
 * serializable).
 */
export async function resolveLoginDestination(
  supabase: SupabaseClient<Database>,
  userId: string,
  redirectTo?: string | null
): Promise<string> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  const home = profile ? getRoleHomePath(profile.role) : "/patient";
  return sanitizeRedirect(redirectTo) ?? home;
}

/**
 * Where every "a session now exists, send them in" path lands: records the
 * device (best-effort new-device notification, never blocks — see
 * record-login-device.ts) and resolves the destination concurrently, since
 * neither depends on the other's result, then redirects. Shared by the
 * password/phone login actions and signup's own auto-confirm redirect (when
 * email confirmations are disabled and signUp() returns a session directly).
 * If the account has a verified MFA factor, proxy.ts (the single choke point
 * for auth gating — see its own header comment) catches the resulting aal1
 * session on the very next request and bounces it to /login/mfa-challenge
 * before it reaches whatever page this sends it to — nothing here needs to
 * know about MFA at all.
 */
export async function redirectAfterLogin(
  supabase: SupabaseClient<Database>,
  userId: string,
  redirectTo?: FormDataEntryValue | string | null
): Promise<never> {
  const [, destination] = await Promise.all([
    recordLoginDevice(supabase),
    resolveLoginDestination(supabase, userId, redirectTo?.toString()),
  ]);
  redirect(destination);
}
