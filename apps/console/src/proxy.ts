import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@tarragon/auth/supabase/middleware";
import { evaluateConsoleAccess, consoleRoles } from "@tarragon/auth/console-areas";
import { getRoleHomePath } from "@tarragon/auth/roles";

/**
 * The console's single choke point for authentication and role gating, the
 * counterpart of apps/web/src/proxy.ts. Same dispositions, deliberately:
 *
 *  - The session is refreshed on EVERY request that reaches this function.
 *    Nothing here may be skippable by a request header (apps/web learned this
 *    the hard way: a `missing:` matcher clause let `purpose: prefetch` bypass
 *    the whole gate). The only exclusions are static build assets and the
 *    liveness route, neither of which serves data.
 *  - MFA step-up: a session that has a verified TOTP factor but has not
 *    completed the challenge is sent to /login/mfa-challenge before it can
 *    reach anything.
 *  - Fail CLOSED: a signed-in caller whose `profiles` row cannot be read gets
 *    no console page, never an unfiltered response.
 *  - Default-deny by area: only paths listed in CONSOLE_AREAS are served, and
 *    only to a role that owns them (or the super admin, for oversight). Each
 *    page still enforces its own gates and RLS still governs the data.
 *
 * Sessions on this host are host-only cookies (no `domain` attribute is ever
 * set), so a session created on the main app is NOT visible here and the
 * reverse. That is the isolation guarantee, not an accident.
 */
export async function proxy(request: NextRequest) {
  const { response, supabase, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  const toLogin = () => {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") loginUrl.searchParams.set("redirect", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  };

  if (!user) {
    if (pathname === "/login" || pathname === "/login/mfa-challenge") return response;
    return toLogin();
  }

  if (pathname !== "/login/mfa-challenge") {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel) {
      const challengeUrl = new URL("/login/mfa-challenge", request.url);
      challengeUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(challengeUrl);
    }
  }

  // Role comes from `profiles`, never from JWT metadata (which is
  // user-editable). Mirrors the RLS helper functions.
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();

  if (!profile) {
    return pathname === "/login" ? response : toLogin();
  }

  const isConsoleRole = consoleRoles().includes(profile.role);

  // A signed-in person with no console access sees the login page (which
  // explains it and offers sign-out) and nothing else. Never redirect them
  // from /login to /login.
  if (!isConsoleRole) {
    return pathname === "/login" || pathname === "/login/mfa-challenge" ? response : toLogin();
  }

  const home = getRoleHomePath(profile.role);
  if (pathname === "/" || pathname === "/login") {
    return NextResponse.redirect(new URL(home, request.url));
  }
  if (pathname === "/login/mfa-challenge") return response;

  if (!evaluateConsoleAccess(pathname, profile.role).allowed) {
    return NextResponse.redirect(new URL(home, request.url));
  }

  return response;
}

export const config = {
  matcher: [
    {
      // No `missing:` clause, and none may be added (see the note above and
      // apps/web/src/proxy.ts). `api/health` is liveness only and must not
      // depend on Supabase Auth being reachable.
      source: "/((?!_next/static|_next/image|favicon.ico|api/health|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    },
  ],
};
