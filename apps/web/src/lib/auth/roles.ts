import type { UserRole } from "@tarragon/shared";
import { isMarketingPath } from "@/lib/marketing/routes";

/** Where each profiles.role lands after login (FEATURE_SPEC.md §6 dashboards). */
export const ROLE_HOME_PATH: Record<UserRole, string> = {
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
  payer_admin: "/payer",
  provider_org_staff: "/provider-org",
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
  // Module 27/28 — built dormant (see platform_modules), gated by
  // private.module_enabled('payer_platform' / 'provider_org_platform').
  // These labels exist so a seat can be provisioned and its own dashboard
  // built ahead of activation; they carry no meaning until a superadmin
  // switches the module on via public.set_platform_module().
  payer_admin: "Payer Admin",
  provider_org_staff: "Provider Organisation Staff",
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

/** Any of the role-home prefixes — used to detect "protected area" requests. */
export function isRoleHomePrefixed(pathname: string): boolean {
  return Object.values(ROLE_HOME_PATH).some(
    (home) => pathname === home || pathname.startsWith(`${home}/`)
  );
}
