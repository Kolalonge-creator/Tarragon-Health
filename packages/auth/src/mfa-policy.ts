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
 * set up (its server actions, sign-out included, post to the same path), the challenge page, and the auth callbacks that
 * finish a sign-in or a sign-out.
 */
export function isMfaEnrolmentExemptPath(pathname: string): boolean {
  // Exactly /account, not /account/*: the credentialing pages live under /account/clinician and must not inherit the exemption.
  return pathname === MFA_SETUP_PATH || pathname === "/login/mfa-challenge" || pathname.startsWith("/auth/");
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

// `at` is when the value was read. The value is kept after the window as the last known answer: a failed read is only
// treated as "a group may be on" when the last answer this instance saw was that one is.
let anyGroupCache: { value: boolean; at: number } | null = null;

/** Test hook. */
export function resetMfaRequirementCache(): void {
  anyGroupCache = null;
}

type Client = SupabaseClient<Database>;

/** PostgREST "no such function" (the migration is not applied yet) and Postgres "undefined function". */
export function isMissingFunction(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}

/** What the proxy does when the caller's own answer cannot be read. */
export type MfaLookupFailure = "required" | "not_required";

type MyRequirement = { required: boolean; hasVerifiedFactor: boolean };

/** The caller's own row from public.my_mfa_requirement: the answer, null when unreadable, or not-required when not deployed. */
async function readMyRow(supabase: Client): Promise<MyRequirement | null> {
  const { data, error } = await supabase.rpc("my_mfa_requirement");
  if (error) return isMissingFunction(error) ? { required: false, hasVerifiedFactor: false } : null;
  const row = Array.isArray(data) ? data[0] : data;
  // No row means no signed-in user, which every caller handles before asking.
  return { required: row?.required === true, hasVerifiedFactor: row?.has_verified_factor === true };
}

/**
 * The caller's own answer for a server page or action: `required` true, false, or null when it could not be read. The
 * functions not existing yet (code deployed before the migration) reads as not required.
 */
export async function readMyMfaRequirement(supabase: Client): Promise<boolean | null> {
  const row = await readMyRow(supabase);
  return row === null ? null : row.required;
}

/**
 * Whether the signed-in caller must still SET UP 2FA, read from the database: its group is required AND the database shows no
 * verified factor. An account the database shows WITH a factor is never sent to set-up, even when its session cookie has not
 * caught up (a factor enrolled on another device stays invisible to getAuthenticatorAssuranceLevel until the token refreshes);
 * sending it to set-up would bounce it between /account and its destination. Such a session is still AAL1, so the database
 * layer keeps refusing it patient data until it passes the challenge.
 *
 * While no group is on (today, and the shipped default) this costs one small, cached RPC per proxy instance every 30 seconds,
 * not one per request. Only when a group is on is the caller's own answer read, uncached, so a change applies within the
 * cache window and an account can never be served another account's verdict.
 *
 * Failure handling:
 *  - the functions do not exist yet (code deployed before the migration): not required, exactly today's behaviour;
 *  - "is any group on" fails: not required, unless the last answer this instance saw was "a group is on", in which case the
 *    caller's own answer is asked (a brief fault while every group is off never sends everybody to set-up);
 *  - the caller's own answer fails: `onFailure`, REQUIRED by default (fail closed): the person lands on Profile & settings,
 *    which reads the true state. The mobile API passes "not_required": there a failed lookup is most often an expired token,
 *    which the route itself must answer with a 401 so the app refreshes.
 *    The database layer (is_org_staff / is_admin / has_permission) holds independently of this.
 */
export async function isMfaRequiredForCaller(
  supabase: Client,
  now: number = Date.now(),
  onFailure: MfaLookupFailure = "required",
): Promise<boolean> {
  if ((await anyMfaGroupRequired(supabase, now)) === false) return false;
  const row = await readMyRow(supabase);
  if (row === null) return onFailure === "required";
  return row.required && !row.hasVerifiedFactor;
}

/**
 * Is any group on at all: true or false. Cached per instance for ANY_GROUP_CACHE_MS; the value is platform-wide, never per
 * account. Missing functions (code deployed before the migration) read as false. A failed read is not cached and answers the
 * last known value, or false if this instance never read one.
 */
export async function anyMfaGroupRequired(supabase: Client, now: number = Date.now()): Promise<boolean> {
  if (anyGroupCache && now - anyGroupCache.at < ANY_GROUP_CACHE_MS) return anyGroupCache.value;
  const anyOn = await supabase.rpc("mfa_any_group_required");
  if (anyOn.error) return isMissingFunction(anyOn.error) ? false : (anyGroupCache?.value ?? false);
  anyGroupCache = { value: anyOn.data === true, at: now };
  return anyGroupCache.value;
}

/**
 * Where a just-signed-in session must go first. A Server Action's redirect() makes Next render the destination INSIDE the same
 * response, without a new request through the proxy, so neither proxy gate sees the first page after a sign-in. Each app's
 * login action calls this before redirecting:
 *  - a verified factor and an AAL1 session: `challengePath?redirect=<destination>`;
 *  - a required group and no factor: `setupPath`, with the destination kept;
 *  - otherwise the destination. If the level cannot be read the destination is kept (the proxy gates the next request).
 */
export async function loginGateTarget(
  supabase: Client,
  destination: string,
  paths: { challengePath: string; setupPath: (destination: string) => string },
): Promise<string> {
  try {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      return `${paths.challengePath}?redirect=${encodeURIComponent(destination)}`;
    }
    const pathname = destination.split(/[?#]/)[0] ?? destination;
    const required = await isMfaRequiredForCaller(supabase);
    if (mfaEnrolmentVerdict({ pathname, required, nextLevel: aal?.nextLevel }) === "setup") {
      return paths.setupPath(destination);
    }
  } catch {
    // Unreadable: keep the destination; the proxy gates the next request.
  }
  return destination;
}

/**
 * The access token of a phone-app request, found the way the /api/mobile routes find it: the Authorization header, then a
 * `?token=` query parameter (used by the PDF and image routes the app opens in a browser view).
 */
export function requestAccessToken(headers: Headers, searchParams: URLSearchParams): string | null {
  return bearerToken(headers) ?? (searchParams.get("token") || null);
}

/** The bearer token of a request, or null. */
export function bearerToken(headers: Headers): string | null {
  const raw = headers.get("authorization");
  if (!raw) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(raw.trim());
  return match ? match[1]! : null;
}

/**
 * The `aal` claim of a Supabase access token, decoded WITHOUT verifying the signature. Safe only as a shortcut to skip a lookup:
 * a forged "aal2" token is refused by the route (and PostgREST) when it verifies the signature, so it gains nothing here.
 */
export function aalFromAccessToken(token: string): string | undefined {
  const part = token.split(".")[1];
  if (!part) return undefined;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))) as unknown;
    if (json && typeof json === "object" && "aal" in json && typeof json.aal === "string") return json.aal;
    return undefined;
  } catch {
    return undefined;
  }
}
