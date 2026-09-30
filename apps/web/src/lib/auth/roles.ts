import { isMarketingPath } from "@/lib/marketing/routes";

// The role map itself (home paths, labels, path matching) lives in
// @tarragon/auth so apps/web and apps/console cannot drift on it.
export * from "@tarragon/auth/roles";

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
