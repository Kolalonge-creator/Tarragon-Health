/**
 * Options for the Supabase session cookies (security audit 2026-11-05, M-6). Every Supabase client that reads or writes the
 * session passes these, so the cookie is the same whichever path last wrote it.
 *
 * - `secure`: the session cookie is never sent over plain HTTP. On the server it is on for every Vercel deployment (always
 *   HTTPS); in the browser it follows the page's own protocol, so local `next dev` / `next start` on http://localhost still
 *   works.
 * - Never a `domain`: web session cookies are host-only by design (S01d, see this package's description).
 * - `httpOnly` stays false and the lifetime stays the library default: the browser client must read the cookie, and a shorter
 *   lifetime is a sign-in friction decision deferred with staff MFA and idle sign-out.
 */
export function sessionCookieOptions(): { secure: boolean } {
  if (typeof window !== "undefined") return { secure: window.location.protocol === "https:" };
  return { secure: process.env.VERCEL === "1" };
}
