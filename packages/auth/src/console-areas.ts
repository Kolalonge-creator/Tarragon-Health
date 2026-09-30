import type { UserRole } from "@tarragon/shared";
import { isRoleHomePrefixed, pathMatchesRole, ROLE_HOME_PATH } from "./roles";

/**
 * Staff areas that have been extracted from apps/web into apps/console (S01d,
 * founder decision F-04). This list is the single source of truth for BOTH
 * apps: apps/web redirects these prefixes to the console host, and
 * apps/console refuses to serve anything that is not on it.
 *
 * An area is added here in the same change that moves its routes, never before
 * (the route must exist on the console first) and never after (web would keep
 * a live copy of a page with a second, un-audited set of role gates).
 */
export const CONSOLE_AREAS = ["/ngo"] as const;

export type ConsoleArea = (typeof CONSOLE_AREAS)[number];

/** True when `pathname` is one of the extracted areas or sits under one. */
export function isConsolePath(pathname: string): boolean {
  return CONSOLE_AREAS.some((area) => pathname === area || pathname.startsWith(`${area}/`));
}

/** Roles whose own home is an extracted area. Nobody else signs in on the console. */
export function consoleRoles(): UserRole[] {
  return (Object.entries(ROLE_HOME_PATH) as [UserRole, string][])
    .filter(([, home]) => isConsolePath(home))
    .map(([role]) => role);
}

export type ConsoleAccess =
  | { allowed: true }
  | { allowed: false; reason: "not_console_area" | "role_not_permitted" };

/**
 * Whether `role` may open `pathname` on the console. Mirrors the role-area
 * rule in apps/web/src/proxy.ts (a role reaches its own home and below; the
 * super admin may traverse every area for oversight), but is default-deny
 * for anything that is not an extracted area, so a route that is mistakenly
 * left in the console tree is never served by accident.
 *
 * Deliberately pure (no I/O) so it can be tested exhaustively. Each page
 * still enforces its own gates and RLS still governs the data; this only
 * decides whether the door opens.
 */
export function evaluateConsoleAccess(pathname: string, role: UserRole): ConsoleAccess {
  if (!isConsolePath(pathname) || !isRoleHomePrefixed(pathname)) {
    return { allowed: false, reason: "not_console_area" };
  }
  if (role === "admin" || pathMatchesRole(pathname, role)) {
    return { allowed: true };
  }
  return { allowed: false, reason: "role_not_permitted" };
}
