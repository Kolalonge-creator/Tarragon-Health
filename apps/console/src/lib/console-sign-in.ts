import type { UserRole } from "@tarragon/shared";
import { consoleRoles, evaluateConsoleAccess } from "@tarragon/auth/console-areas";
import { getRoleHomePath } from "@tarragon/auth/roles";
import { sanitizeRedirect } from "@tarragon/auth/redirect";

/**
 * Who may hold a session on the console host, and where a fresh sign-in lands.
 *
 * Only roles whose own home is an extracted area may sign in here. Everyone
 * else (every patient, and any staff role whose area still lives in apps/web)
 * is refused at the door and signed out of THIS host's cookie jar, so the
 * console never accumulates sessions it has no pages for. Sessions are
 * host-only by design (see docs/design/S01d.md section 3), so refusing here
 * does not touch the person's session on the main app.
 */
export function canSignInToConsole(role: UserRole): boolean {
  return consoleRoles().includes(role);
}

/** The sanitized intended path if this role may open it, otherwise the role's home. */
export function resolveConsoleDestination(role: UserRole, redirectTo?: string | null): string {
  const candidate = sanitizeRedirect(redirectTo);
  if (candidate) {
    const pathOnly = candidate.split(/[?#]/, 1)[0] ?? candidate;
    if (evaluateConsoleAccess(pathOnly, role).allowed) return candidate;
  }
  return getRoleHomePath(role);
}
