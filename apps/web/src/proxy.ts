import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import {
  getRoleHomePath,
  isPublicPath,
  isRoleHomePrefixed,
  pathMatchesRole,
} from "@/lib/auth/roles";
import { isAppHost } from "@/lib/marketing/host";
import { isMarketingPath } from "@/lib/marketing/routes";

// Next.js 16 renamed `middleware.ts` -> `proxy.ts` (same file-convention
// contract, function must be named/exported `proxy`).
export async function proxy(request: NextRequest) {
  const { response, supabase, user } = await updateSession(request);
  const { pathname } = request.nextUrl;
  const host = request.headers.get("host") ?? "";
  const isApp = isAppHost(host);

  // app.tarragonhealth.com (or app.localhost): "/" is platform entry, not marketing homepage
  if (isApp && pathname === "/") {
    if (!user) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile) {
      return NextResponse.redirect(new URL(getRoleHomePath(profile.role), request.url));
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (!user) {
    if (isRoleHomePrefixed(pathname)) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  // Role authorization is derived from `profiles`, never from JWT metadata
  // (which is user-editable) — mirrors the RLS helper functions in
  // supabase/migrations/20260705000001_core_auth_multitenancy.sql.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return response;
  }

  const home = getRoleHomePath(profile.role);

  // Auth-only public paths (login/signup) — not marketing pages
  if (isPublicPath(pathname) && pathname !== "/" && !isMarketingPath(pathname)) {
    return NextResponse.redirect(new URL(home, request.url));
  }

  if (isRoleHomePrefixed(pathname) && !pathMatchesRole(pathname, profile.role)) {
    return NextResponse.redirect(new URL(home, request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
