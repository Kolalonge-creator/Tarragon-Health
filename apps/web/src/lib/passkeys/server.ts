import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@tarragon/shared";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * A server Supabase client that has opted in to the (experimental) passkey calls of Supabase Auth. It reads and writes the same
 * session cookies as the ordinary server client, so a passkey sign-in lands as a normal session. It is NOT cached with
 * React.cache: a passkey sign-in must be able to swap the session on the client it later redirects with.
 *
 * Kept apart from `@/lib/supabase/server` on purpose: the experimental flag stays out of every other request.
 */
export async function createPasskeyClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { experimental: { passkey: true } },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: the proxy refreshes the session, so a failed write here is safe to ignore.
        }
      },
    },
  });
}

/**
 * Is the platform switch `passkeys` on? Fail closed: an RPC error, an unknown switch and "off" all answer false, which every
 * caller treats as "passkeys do not exist". Anonymous-safe (the sign-in page asks before anyone is signed in).
 */
export async function passkeysSwitchOn(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("platform_switch_is_on", { p_key: "passkeys" });
    return !error && data === true;
  } catch {
    return false;
  }
}

/**
 * Is the database gate on the credential table installed? The gate is what makes "add a passkey" need a fresh password check even
 * when someone talks to Auth directly with a stolen access token. If it is not installed (for example a database whose Auth
 * version has no credential table), the feature stays closed rather than running without its guard.
 */
export async function passkeyGateReady(): Promise<boolean> {
  try {
    // Service role: the readiness check reveals nothing about any person, but it is not granted to signed-out roles either.
    const { data, error } = await createServiceRoleClient().rpc("passkey_gate_ready");
    return !error && data === true;
  } catch {
    return false;
  }
}

/** Switch on AND the database gate installed. Either one missing means passkeys do not exist, for everyone. */
export async function passkeysAvailable(): Promise<boolean> {
  // Switch first: with the feature off (the default) a signed-out visit costs one cheap call, not two.
  if (!(await passkeysSwitchOn())) return false;
  return passkeyGateReady();
}

/** The signed-in caller, but only when their account is an active patient's. Never trusts anything from the browser. */
export async function activePatientUser() {
  const user = await getCurrentUser();
  if (!user) return { user: null, error: "sessionExpired" as const };
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
  if (!profile || profile.role !== "patient" || profile.is_active !== true) return { user: null, error: "notAvailableForAccount" as const };
  return { user, error: null };
}
