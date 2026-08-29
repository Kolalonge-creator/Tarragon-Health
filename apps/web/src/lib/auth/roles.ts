import type { UserRole } from "@tarragon/shared";
import { isMarketingPath } from "@/lib/marketing/routes";

/** Where each profiles.role lands after login (FEATURE_SPEC.md §6 dashboards). */
const ROLE_DASHBOARD_HOME = {
  patient: "/patient",
  clinician: "/clinician",
  admin: "/admin",
  hmo_admin: "/dashboard/hmo",
  corporate_admin: "/dashboard/corporate",
  care_coordinator: "/dashboard/care-coordinator",
  pharmacist: "/pharmacist",
  analyst: "/analytics",
  lab_liaison: "/lab-liaison",
  finance: "/finance",
  lab_partner: "/lab-partner",
} as const;

/**
 * `payer_admin` and `provider_org_staff` are in the database's user_role enum
 * but have no dashboard area on the platform, so they land on /account rather
 * than on `undefined` — which is what getRoleHomePath returned for them until
 * the generated types were refreshed and made the gap visible.
 *
 * Deliberately kept OUT of the role-home prefix set below. /account is
 * everybody's page: adding it as a role home would make isRoleHomePrefixed
 * true for it, and proxy.ts would then bounce every other role off their own
 * account page. Give either role a real dashboard and it moves up into
 * ROLE_DASHBOARD_HOME.
 */
const ROLE_WITHOUT_DASHBOARD_HOME = {
  payer_admin: "/account",
  provider_org_staff: "/account",
} as const;

export const ROLE_HOME_PATH: Record<UserRole, string> = {
  ...ROLE_DASHBOARD_HOME,
  ...ROLE_WITHOUT_DASHBOARD_HOME,
};

export function getRoleHomePath(role: UserRole): string {
  return ROLE_HOME_PATH[role];
}

/** Short, patient/staff-facing role name — shown in the app shell's profile
 * menu and on /account. Deliberately terser than USER_ROLE_LABELS
 * (lib/validation/members.ts), which is written for the admin provisioning
 * screen and carries internal detail (e.g. "set doctor_tier on
 * clinical_staff") that has no business appearing in someone's own account
 * menu. "Supporter" (a person who funds another patient's care and has none
 * of their own) is not a profiles.role value, so it is handled by the caller,
 * not this map. */
export const ROLE_DISPLAY_LABEL: Record<UserRole, string> = {
  patient: "Patient",
  clinician: "Doctor",
  admin: "Admin",
  hmo_admin: "HMO admin",
  corporate_admin: "Corporate admin",
  care_coordinator: "Care Coordinator",
  pharmacist: "Partner Pharmacy",
  analyst: "Platform Analytics",
  finance: "Finance",
  lab_liaison: "Lab Liaison",
  lab_partner: "Partner Laboratory",
  payer_admin: "Payer admin",
  provider_org_staff: "Provider organisation staff",
};

/** True when `pathname` is the role-home (or under it) for `role`. */
export function pathMatchesRole(pathname: string, role: UserRole): boolean {
  const home = ROLE_HOME_PATH[role];
  return pathname === home || pathname.startsWith(`${home}/`);
}

/** Paths reachable without a session. */
export const PUBLIC_PATHS = ["/", "/login", "/signup", "/forgot-password"];

export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/auth/") ||
    // The emergency card is deliberately reachable with no session: the person
    // it protects may be unconscious, and a stranger doctor has no account.
    // The 32-byte token in the URL is the credential, and the patient can
    // revoke it instantly. See 20260803130000_emergency_cards.sql.
    pathname.startsWith("/emergency/") ||
    isMarketingPath(pathname)
  );
}

/** Any of the role-home prefixes — used to detect "protected area" requests.
 * Reads ROLE_DASHBOARD_HOME, not ROLE_HOME_PATH: see the comment on
 * ROLE_WITHOUT_DASHBOARD_HOME for why /account must not be in this set. */
export function isRoleHomePrefixed(pathname: string): boolean {
  return Object.values(ROLE_DASHBOARD_HOME).some(
    (home) => pathname === home || pathname.startsWith(`${home}/`)
  );
}
