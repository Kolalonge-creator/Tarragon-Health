import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { getRoleHomePath } from "./roles";
import { sanitizeRedirect } from "./redirect";

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
