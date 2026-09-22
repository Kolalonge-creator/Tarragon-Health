/**
 * Idle-session timeout — closes a real gap a 2026-09-18 security audit found:
 * previously, an authenticated session never expired from inactivity at all.
 * `lib/supabase/middleware.ts`'s `updateSession()` calls `supabase.auth.getUser()`
 * on every request, which silently refreshes the access token off the refresh
 * token cookie forever — there was no mechanism anywhere that ever forced a
 * re-login just because nobody had touched the tab in hours. Supabase's own
 * `jwt_expiry` (3600s, see supabase/config.toml) only bounds the access
 * token's own lifetime, not the session as a whole; the refresh token itself
 * has no inactivity expiry configured. That is a real difference from an
 * enterprise-grade patient portal (Epic MyChart, a well-run fintech), which
 * always forces re-auth after a bounded period of no activity, independent of
 * how long the underlying credential would otherwise remain valid.
 *
 * This is enforced in `proxy.ts` — the platform's single existing choke point
 * for session-shaped decisions (see its own header comments on the MFA
 * step-up gate and the supporter default-deny gate for why a per-page check
 * would be the wrong shape). "Activity" is deliberately defined as any
 * request that reaches the proxy while authenticated — the same definition
 * most idle-timeout implementations use; there is no separate heartbeat.
 *
 * Deliberately NOT using `supabase.auth.signOut()` here: that call re-invokes
 * the SAME cookie-storage adapter `lib/supabase/middleware.ts` wired up, whose
 * `setAll` callback reassigns a `response` variable that lives in
 * `updateSession`'s own closure — a variable proxy.ts only ever captured a
 * snapshot reference to via destructuring, not a live binding. A signOut()
 * call from here would silently fail to propagate its Set-Cookie headers onto
 * whatever response proxy.ts actually returns. Instead, `buildIdleTimeoutRedirect`
 * clears every `sb-`-prefixed cookie (Supabase SSR's own cookie-name
 * convention) directly from the request's cookie jar onto a fresh redirect
 * response it fully controls — the next request then has no session cookie
 * at all, which is the same practical effect as signing out.
 */
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";

/** Overridable for tests / a future admin-tunable setting; 30 minutes by
 * default — a reasonable enterprise-portal baseline, not a regulator-mandated
 * number (no NDPA-specific figure exists for this), same "first pass, not a
 * claim of sign-off" posture as this codebase's other numeric security
 * thresholds. */
export const IDLE_TIMEOUT_MS = (() => {
  const minutes = Number(process.env.IDLE_TIMEOUT_MINUTES);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60 * 1000;
})();

export const LAST_ACTIVITY_COOKIE = "th_last_seen";

/**
 * Paths that must NEVER count as "activity" for idle-timeout purposes,
 * because they fire on a fixed interval regardless of whether a real person
 * is at the keyboard — `components/shell/device-heartbeat.tsx` posts to
 * `/api/heartbeat` every 4 minutes purely because the tab is visible, and
 * `components/analytics/page-tracker.tsx` does the same to `/api/track` (on
 * top of its legitimate per-navigation pageview beacon, which is harmless to
 * exclude too: the navigation itself already generates its own separate
 * request to the real page route, which DOES stamp activity). Without this
 * exclusion, a patient who signs in on a shared computer, opens their
 * dashboard, and walks away leaving the tab open and visible would never
 * actually time out — the exact unattended-device scenario this feature
 * exists to close. `request.nextUrl.pathname` never includes the query
 * string, so an exact match on these two fixed route paths is sufficient.
 */
export function isBackgroundTelemetryPath(pathname: string): boolean {
  return pathname === "/api/heartbeat" || pathname === "/api/track";
}

/**
 * Paths that must NEVER be idle-timed-out, because they're themselves a
 * mid-flow, already-authenticated-for-one-specific-purpose step — same
 * category as `/auth/*`, which the idle check already exempts for this
 * reason. Found before merge as a real interaction bug between two features
 * added in the same change: an account locked out by repeated failed
 * logins (20260918111442_account_lockout_after_repeated_failed_logins.sql)
 * clicks their password-reset email, lands on /reset-password, but takes
 * longer than IDLE_TIMEOUT_MINUTES to compose and submit a new password —
 * without this exemption, the idle gate would intercept that POST and
 * redirect to /login?reason=idle before updatePassword() ever runs, so the
 * clear_login_failures() call added specifically to un-stick that recovery
 * path (reset-password/actions.ts) would never execute. /forgot-password
 * and /login/mfa-challenge are the same shape: a session already mid-way
 * through recovering or stepping up, not a signal of a stale session
 * sitting untouched.
 *
 * `/checkout/<code>` (the guest-checkout OTP-entry page,
 * app/checkout/[code]/page.tsx) is the same shape again — a guest fills in
 * the form and types a code emailed to them, not a signal of a stale
 * session sitting untouched. Deliberately NOT a blanket `/checkout` prefix,
 * unlike an earlier version of this exemption: /checkout/continue
 * (app/checkout/continue/page.tsx) calls purchaseServiceProduct() — a real,
 * authenticated purchase — gated only on getCurrentUser(), with no recency
 * check of its own. A blanket prefix would have meant a signed-in patient
 * (not just a guest) who leaves a tab open and idle on a shared/public
 * computer well past the idle threshold is never bounced when someone else
 * navigates to /checkout/continue?code=... (browser back/forward, a
 * bookmark, a copied link) — the purchase would go through on an account
 * that's been unattended well past IDLE_TIMEOUT_MINUTES, exactly the
 * scenario idle-timeout exists to prevent. A real financial transaction
 * must still respect the idle timeout, whether the buyer is a guest or an
 * already-authenticated patient — /checkout/continue and /checkout/receipt
 * are deliberately excluded.
 */
export function isIdleTimeoutExemptPath(pathname: string): boolean {
  return (
    pathname === "/reset-password" ||
    pathname === "/forgot-password" ||
    pathname === "/login/mfa-challenge" ||
    (pathname.startsWith("/checkout/") &&
      !pathname.startsWith("/checkout/continue") &&
      !pathname.startsWith("/checkout/receipt"))
  );
}

/** True when the recorded last-activity cookie is old enough that the
 * session should be treated as idle-expired. A missing/unparseable cookie is
 * NOT idle — that is the normal shape of the very first authenticated
 * request after a fresh sign-in, before this cookie has ever been stamped
 * (see stampActivity's own comment for why the cookie's own browser-side
 * lifetime is deliberately much longer than IDLE_TIMEOUT_MS, which is what
 * keeps "missing" a reliable signal for "never stamped" rather than also
 * meaning "stamped so long ago the browser itself dropped it"). */
export function isSessionIdle(lastSeenCookieValue: string | undefined, now: number): boolean {
  if (!lastSeenCookieValue) return false;
  const lastSeen = Number(lastSeenCookieValue);
  if (!Number.isFinite(lastSeen)) return false;
  return now - lastSeen > IDLE_TIMEOUT_MS;
}

/** How long the activity cookie itself is allowed to live in the browser —
 * deliberately MUCH longer than IDLE_TIMEOUT_MS, and NOT derived from it.
 * Bug fixed before merge: an earlier version set this to IDLE_TIMEOUT_MS + 60s
 * (~31 minutes for the 30-minute default), which meant a session abandoned
 * for LONGER than that window had its cookie expire and get DROPPED by the
 * browser before the next request ever arrived — that next request then saw
 * no cookie at all, isSessionIdle() read that as "fresh, never stamped", and
 * a session left untouched for e.g. 2 hours on a shared computer was waved
 * through with full access instead of being bounced to /login?reason=idle —
 * the exact inverse of what the feature exists to do, and the longer a
 * session sat abandoned, the more certain the bypass became. Giving the
 * cookie a lifetime of days rather than minutes decouples "does the cookie
 * still exist" from "is the session still fresh": staleness is judged purely
 * by the STORED TIMESTAMP (isSessionIdle's own comparison), never by whether
 * the browser has garbage-collected the cookie — so "missing" reliably means
 * only "never stamped" (the one genuine case: right after login, before the
 * very first authenticated request has run), not "stamped ages ago". */
const ACTIVITY_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

/** The one place the cookie's own options are written — both stampActivity
 * (proxy.ts) and stampActivityCookie (server actions, below) go through
 * this so the two can never drift apart. */
function activityCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ACTIVITY_COOKIE_MAX_AGE_SECONDS,
  };
}

/** Stamps the current-activity cookie onto a response that's about to be
 * returned for real (best-effort — a handful of intermediate redirect
 * branches in proxy.ts return a different response object and skip this; the
 * very next real page load re-stamps it, same "best-effort, never block a
 * real request" posture as lib/rate-limit.ts and record-login-device.ts). */
export function stampActivity(response: NextResponse, now: number): void {
  response.cookies.set(LAST_ACTIVITY_COOKIE, String(now), activityCookieOptions());
}

/**
 * Server Action equivalent of stampActivity, for the moment a session
 * actually BEGINS (a successful sign-in/checkout-OTP-verify/password-reset)
 * rather than an ordinary already-authenticated request through proxy.ts.
 *
 * Regression fixed before merge: nothing stamped or cleared th_last_seen at
 * login, so a user whose PREVIOUS session ended any way other than explicit
 * sign-out (browser closed, refresh token naturally expired, walked away —
 * arguably the majority of real sessions; signOut() is the one path that
 * already clears this, see auth/actions.ts) still had that old session's
 * stale cookie sitting in their browser. Logging back in with a correct
 * password redirected straight into the very first authenticated page load,
 * which read the OLD stale timestamp, isSessionIdle() saw it was older than
 * IDLE_TIMEOUT_MS, and immediately bounced the user right back to
 * /login?reason=idle — straight after a successful login, not a rare edge
 * case. Called from redirectAfterLogin (login/actions.ts, shared by the
 * password and phone-OTP paths), and the success paths of
 * verifyGuestCheckoutOtp (guest-checkout.ts), verifyPhoneReset
 * (forgot-password/actions.ts) and updatePassword (reset-password/actions.ts)
 * — every place a fresh, real session is handed to the user and redirected
 * onward. Best-effort, same posture as every other cookie/RPC write in this
 * module: a failure here must never block a real sign-in.
 */
export async function stampActivityCookie(now: number = Date.now()): Promise<void> {
  try {
    (await cookies()).set(LAST_ACTIVITY_COOKIE, String(now), activityCookieOptions());
  } catch {
    // Called from a Server Component render path in some edge case, or any
    // other context where cookies() can't be written — never let this block
    // a real sign-in.
  }
}

/** Builds the redirect for an idle-expired session: clears every Supabase
 * session cookie plus the activity cookie itself, directly from the
 * request's own cookie jar — see the module header for why this is used
 * instead of supabase.auth.signOut() here.
 *
 * Deliberately status 303 ("See Other"), not the default 307: a 307
 * preserves the original method AND body, so a Server Action POST issued
 * from an idle session (someone submits a form after their tab sat past the
 * threshold) would get REPLAYED as a POST to /login — a plain page route
 * with no Server Action matching that request — instead of a clean
 * "signed out" landing. 303 always tells the client to follow up with a
 * plain GET, which is what every idle-timeout redirect actually means here. */
export function buildIdleTimeoutRedirect(request: NextRequest): NextResponse {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("reason", "idle");
  loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
  const redirectResponse = NextResponse.redirect(loginUrl, 303);

  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith("sb-")) {
      redirectResponse.cookies.delete(cookie.name);
    }
  }
  redirectResponse.cookies.delete(LAST_ACTIVITY_COOKIE);

  return redirectResponse;
}
