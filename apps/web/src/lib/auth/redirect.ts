import type { UserRole } from "@tarragon/shared";

const ROLE_HOME: Record<UserRole, string> = {
  patient: "/patient",
  nurse: "/nurse",
  clinician: "/nurse",
  admin: "/admin",
  hmo_admin: "/hmo",
  corporate_admin: "/corporate",
};

export function getHomePathForRole(role: UserRole): string {
  return ROLE_HOME[role];
}

export const PROTECTED_PREFIXES = [
  "/patient",
  "/nurse",
  "/admin",
  "/hmo",
  "/corporate",
] as const;

export const AUTH_PATHS = ["/login", "/sign-up"] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isAuthPath(pathname: string): boolean {
  return AUTH_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}
