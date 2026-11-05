import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * Two-factor sign-in (2FA) required per group of accounts.
 *
 * An admin switches the requirement on or off per group at /admin/settings/two-factor (table
 * public.mfa_group_requirements, migration 20261105110919). Every group ships OFF. While a group is off nothing changes for
 * its accounts: 2FA stays optional and the "Add an extra layer of protection" banner still shows.
 *
 * When a group is on, an account in it:
 *  - without a verified TOTP factor reaches only Profile & settings (/account, where it sets one up), the challenge page, the
 *    auth callbacks and the public pages, so it can always sign out. An /api request gets a 403 instead of a redirect;
 *  - with a factor must complete the challenge (AAL2). That part is the existing step-up gate in each proxy, which already
 *    applies to every account with a factor whether its group is on or not.
 *
 * The proxy is not the only layer: in the database, private.is_org_staff and private.is_admin return false for an account in
 * a required group until its session is AAL2, so a stolen AAL1 token sent straight to the API reads no patient data through
 * them either.
 *
 * Replaces the hard-coded "every staff role" policy of the closed PR #1737 (SEC-01: founder decided on 2026-11-05 not to
 * force 2FA yet). This module decides nothing by role: the database says which groups are on.
 */

/** Where an account in a required group without a factor is sent, on the main app. */
export const MFA_SETUP_PATH = "/account";

/**
 * Paths an account in a required group without a factor may still open on the main app: the account page where the factor is
 * set up (its server actions post to the same path), the challenge page, and the auth callbacks that finish a sign-in or a
 * sign-out.
 */
export function isMfaEnrolmentExemptPath(pathname: string): boolean {
  return (
    pathname === MFA_SETUP_PATH ||
    pathname.startsWith(`${MFA_SETUP_PATH}/`) ||
    pathname === "/login/mfa-challenge" ||
    pathname.startsWith("/auth/")
  );
}

export type MfaEnrolmentVerdict = "allow" | "setup" | "refuse_api";

/**
 * What the proxy does with a signed-in request.
 *
 * `nextLevel` is Supabase's getAuthenticatorAssuranceLevel().nextLevel: "aal2" when the account has at least one verified
 * factor, "aal1" when it has none. An unreadable level (undefined) counts as "no factor": fail closed, the person lands on the
 * set-up page, which reads and shows the true state.
 */
export function mfaEnrolmentVerdict(input: {
  pathname: string;
  required: boolean;
  nextLevel: string | null | undefined;
}): MfaEnrolmentVerdict {
  if (!input.required) return "allow";
  if (input.nextLevel === "aal2") return "allow";
  if (isMfaEnrolmentExemptPath(input.pathname)) return "allow";
  if (input.pathname === "/api" || input.pathname.startsWith("/api/")) return "refuse_api";
  return "setup";
}

/** How long a proxy instance trusts its answer to "is any group on at all". The per-account answer is never cached. */
export const ANY_GROUP_CACHE_MS = 30_000;

let anyGroupCache: { value: boolean; at: number } | null = null;

/** Test hook. */
export function resetMfaRequirementCache(): void {
  anyGroupCache = null;
}

type Client = SupabaseClient<Database>;

/** PostgREST "no such function" (the migration is not applied yet) and Postgres "undefined function". */
function isMissingFunction(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}

/**
 * Whether the signed-in caller must have 2FA, read from the database.
 *
 * While no group is on (today, and the shipped default) this costs one small, cached RPC per proxy instance every 30 seconds,
 * not one per request. Only when a group is on is the caller's own answer read, uncached, so a change applies within the
 * cache window and an account can never be served another account's verdict.
 *
 * Failure handling:
 *  - the functions do not exist yet (code deployed before the migration): not required, exactly today's behaviour;
 *  - "is any group on" fails for another reason: not cached, fall through to the caller's own answer;
 *  - the caller's own answer fails: REQUIRED (fail closed). The person lands on Profile & settings, which reads the true state.
 *    The database layer (is_org_staff / is_admin) holds independently of this.
 */
export async function isMfaRequiredForCaller(supabase: Client, now: number = Date.now()): Promise<boolean> {
  const cached = anyGroupCache && now - anyGroupCache.at < ANY_GROUP_CACHE_MS ? anyGroupCache.value : null;
  if (cached === false) return false;

  if (cached === null) {
    const anyOn = await supabase.rpc("mfa_any_group_required");
    if (anyOn.error) {
      if (isMissingFunction(anyOn.error)) return false;
    } else {
      anyGroupCache = { value: anyOn.data === true, at: now };
      if (anyOn.data !== true) return false;
    }
  }

  const mine = await supabase.rpc("my_mfa_requirement");
  if (mine.error) return !isMissingFunction(mine.error);
  const row = Array.isArray(mine.data) ? mine.data[0] : mine.data;
  // No row means no signed-in user, which the proxies handle before calling this.
  return row?.required === true;
}
