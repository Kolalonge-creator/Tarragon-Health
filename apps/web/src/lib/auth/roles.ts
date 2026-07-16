import type { UserRole } from "@tarragon/shared";
import { isMarketingPath } from "@/lib/marketing/routes";

/** Where each profiles.role lands after login (FEATURE_SPEC.md §6 dashboards). */
export const ROLE_HOME_PATH: Record<UserRole, string> = {
  patient: "/patient",
  clinician: "/clinician",
  doctor: "/doctor",
  admin: "/admin",
  hmo_admin: "/dashboard/hmo",
  corporate_admin: "/dashboard/corporate",
  care_coordinator: "/dashboard/care-coordinator",
  pharmacist: "/pharmacist",
};

export function getRoleHomePath(role: UserRole): string {
  return ROLE_HOME_PATH[role];
}

/** True when `pathname` is the role-home (or under it) for `role`. */
export function pathMatchesRole(pathname: string, role: UserRole): boolean {
  const home = ROLE_HOME_PATH[role];
  return pathname === home || pathname.startsWith(`${home}/`);
}

/** Paths reachable without a session. */
export const PUBLIC_PATHS = ["/", "/login", "/signup"];

export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/auth/") ||
    isMarketingPath(pathname)
  );
}

/** Any of the role-home prefixes — used to detect "protected area" requests. */
export function isRoleHomePrefixed(pathname: string): boolean {
  return Object.values(ROLE_HOME_PATH).some(
    (home) => pathname === home || pathname.startsWith(`${home}/`)
  );
}
