/**
 * Only ever follow a same-origin, path-only redirect target (defends against
 * open-redirect via a crafted `?redirect=` query param).
 */
export function sanitizeRedirect(target: string | null | undefined): string | null {
  if (!target) return null;
  if (!target.startsWith("/") || target.startsWith("//")) return null;
  return target;
}
