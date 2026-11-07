import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { homeForSignedInUser } from "./home-for-signed-in-user";
import { sanitizeRedirect } from "./redirect";
import { recordLoginDevice } from "./record-login-device";
import { MFA_SETUP_PATH, loginGateTarget } from "@tarragon/auth/mfa-policy";

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

  const intended = sanitizeRedirect(redirectTo);
  if (intended) return intended;
  return profile ? homeForSignedInUser(supabase, userId, profile.role) : "/patient";
}

/**
 * Where every "a session now exists, send them in" path lands: records the
 * device (best-effort new-device notification, never blocks — see
 * record-login-device.ts) and resolves the destination concurrently, since
 * neither depends on the other's result, then redirects. Shared by the
 * password/phone login actions and signup's own auto-confirm redirect (when
 * email confirmations are disabled and signUp() returns a session directly).
 * The destination passes through gateLoginDestination below first: proxy.ts
 * cannot gate this redirect, because Next renders a Server Action's redirect
 * target inside the same response.
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
  redirect(await gateLoginDestination(supabase, destination));
}

/**
 * Applies the two 2FA gates to where a just-signed-in session goes. A Server Action's redirect() makes Next render the
 * destination INSIDE the same response, without a new request through proxy.ts, so the proxy's step-up gate and the 2FA group
 * requirement never saw the first page after a password, phone or passkey sign-in (found in the browser check, 2026-11-05: an
 * account with a factor landed on its dashboard at AAL1 until the next navigation). The database layer still refused staff
 * patient data at AAL1, but the page rendered. So the same decisions are made here, before redirecting:
 *  - a verified factor and an AAL1 session: the challenge, keeping the destination;
 *  - a required group and no factor: Profile & settings to set one up, keeping the destination.
 * If the level cannot be read, the destination is kept as before (the proxy decides on the very next request).
 */
export async function gateLoginDestination(supabase: SupabaseClient<Database>, destination: string): Promise<string> {
  return loginGateTarget(supabase, destination, {
    challengePath: "/login/mfa-challenge",
    setupPath: (d) => `${MFA_SETUP_PATH}?mfa=required&redirect=${encodeURIComponent(d)}`,
  });
}
