/**
 * Only ever follow a same-origin, path-only redirect target (defends against
 * open-redirect via a crafted `?redirect=` query param).
 *
 * Rejected, beyond the obvious absolute URL and protocol-relative `//host`:
 *  - a backslash anywhere. Browsers treat `\` as `/` in an http(s) URL, so
 *    `/\evil.example` is read as `//evil.example`, a protocol-relative URL
 *    that starts with a single "/" and slips past a plain `startsWith("//")`.
 *  - any control character (tab, CR, LF and friends), which browsers strip
 *    when parsing a URL, so `/\t/evil.example` collapses to `//evil.example`
 *    the same way.
 */
export function sanitizeRedirect(target: string | null | undefined): string | null {
  if (!target) return null;
  if (!target.startsWith("/") || target.startsWith("//")) return null;
  if (target.includes("\\")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(target)) return null;
  return target;
}
