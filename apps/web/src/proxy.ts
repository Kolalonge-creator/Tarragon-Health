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
    .select("role, custom_role_id")
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

  // The super admin (`admin`) has full platform control and may traverse every
  // role area (analytics console, clinician/patient dashboards, …) for oversight.
  // Each area's own layout guard + RLS still governs what data renders.
  if (
    isRoleHomePrefixed(pathname) &&
    !pathMatchesRole(pathname, profile.role) &&
    profile.role !== "admin"
  ) {
    // A member the super admin has delegated a capability to (a direct grant or
    // an assigned custom role) may enter the /admin area to reach the specific
    // surface they were granted — each admin page independently self-gates on
    // its own permission (hasPermission), so this only opens the door.
    const isAdminArea = pathname === "/admin" || pathname.startsWith("/admin/");
    if (isAdminArea) {
      let hasDelegatedAccess = profile.custom_role_id != null;
      if (!hasDelegatedAccess) {
        const { data: grant } = await supabase
          .from("user_permission_grants")
          .select("id")
          .eq("profile_id", user.id)
          .is("revoked_at", null)
          .limit(1)
          .maybeSingle();
        hasDelegatedAccess = grant != null;
      }
      if (hasDelegatedAccess) {
        return response;
      }
    }
    return NextResponse.redirect(new URL(home, request.url));
  }

  return response;
}

export const config = {
  matcher: [
    {
      // `missing` skips proxy entirely for Next's own Link-hover/viewport
      // prefetch requests — every prefetched dashboard link independently
      // ran this function's getUser() Supabase call, and a page with N
      // links produced N concurrent Auth API calls per render. Real
      // navigations never carry these headers, so page-level auth checks
      // (layout.tsx, RLS) remain the enforcement boundary either way.
      source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
