import type { UserRole } from "@tarragon/shared";

/**
 * Two-step sign-in (TOTP) is REQUIRED for every staff account (founder decision SEC-01, 2026-11-05, master architecture
 * assessment finding S1). Live before this: 0 of 8 staff accounts had a verified factor, and MFA was opt-in for every role.
 *
 * "Staff" is every role except `patient`. A Care Circle supporter is a `patient` account (receives_care = false) and is not
 * staff. Partner, finance and analyst accounts are included on purpose: each can reach data a stolen password must not.
 *
 * `nextLevel` is Supabase's getAuthenticatorAssuranceLevel().nextLevel: "aal2" when the account has at least one verified
 * factor, "aal1" when it has none. An unreadable level (an error, so undefined) counts as "not enrolled": fail closed, the
 * person lands on the set-up page, which shows the true state.
 */
export function staffMustEnrolMfa(
  role: UserRole,
  nextLevel: string | null | undefined,
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): boolean {
  if (isLocalSupabase(supabaseUrl)) return false;
  return isStaffRole(role) && nextLevel !== "aal2";
}

/** Every role except `patient` (supporters are patient accounts). */
export function isStaffRole(role: UserRole): boolean {
  return role !== "patient";
}

/** Whether the gate applies to this role in this deployment (staff, and not a local Supabase stack). */
export function staffMfaRequiredFor(
  role: UserRole,
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): boolean {
  return isStaffRole(role) && !isLocalSupabase(supabaseUrl);
}

/**
 * The one exception: a local Supabase stack (`supabase start`, 127.0.0.1 or localhost). The browser E2E journeys
 * (apps/web/e2e-browser, whose global-setup refuses any other URL) sign in freshly minted staff accounts with a password only.
 * A deployed app points at <ref>.supabase.co, which can never match, and the URL is server configuration, not request input.
 * An unset or unparseable URL is NOT local: fail closed.
 */
export function isLocalSupabase(supabaseUrl: string | undefined): boolean {
  if (!supabaseUrl) return false;
  try {
    const { hostname } = new URL(supabaseUrl);
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

/** Where a staff account without a factor is sent, on the main app. */
export const MFA_SETUP_PATH = "/account";

/**
 * Paths a staff account without a factor may still open on the main app: the account page where the factor is set up (its
 * server actions post to the same path), the challenge page, and the auth callbacks that finish a sign-in or sign-out.
 */
export function isMfaEnrolmentExemptPath(pathname: string): boolean {
  return (
    pathname === MFA_SETUP_PATH ||
    pathname.startsWith(`${MFA_SETUP_PATH}/`) ||
    pathname === "/login/mfa-challenge" ||
    pathname.startsWith("/auth/")
  );
}
