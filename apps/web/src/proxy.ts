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

  // The anon-readable emergency card carries its whole authorisation in the
  // URL's token. A `<meta name="referrer">` tag (set in the page's own
  // metadata) only protects navigations FROM that page; it does nothing about
  // this page's own initial load, and covers nothing if a browser or an
  // embedded webview ignores the meta tag. The HTTP header is the real
  // guarantee: no downstream site this page might ever link to (today: none)
  // can learn the token via a Referer header, belt-and-braces alongside the
  // metadata. Applies regardless of session state — this route needs no role
  // gating, so it exits before any of that logic runs.
  if (pathname.startsWith("/emergency/")) {
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }

  // Health Passport verification is the same class of surface: no account, no
  // role gating, reachable on either hostname because the people using it were
  // handed a printed URL rather than sent from inside the product. It exits
  // before any auth logic so a signed-in patient checking someone else's
  // document is not bounced to their own dashboard.
  //
  // `no-referrer` for the same belt-and-braces reason as the emergency card: the
  // reference in the path is not itself personal data, but it should not leak
  // into the logs of anything this page ever links out to. The key endpoint is
  // deliberately excluded — it is public, cacheable, and meant to be fetched by
  // strangers' tooling.
  if (pathname.startsWith("/verify") || pathname.startsWith("/v/")) {
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }

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
    .select("role, custom_role_id, receives_care")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return response;
  }

  // Somebody who signed up only to fund a relative's care is refused the
  // patient surfaces outright, rather than merely having them dropped from the
  // menu — they have no plan, no consents and no clinical record here, so a
  // hidden link is not a boundary.
  //
  // Deliberately DEFAULT-DENY: anything new added under /patient is closed to
  // supporters unless it is named below. The opposite default would silently
  // open each new clinical surface to accounts that never consented to care.
  //
  // This is the single choke point for it. A per-page guard would have to be
  // remembered sixteen times today and once more for every page added.
  // ...unless they have opened the account of somebody they support, which is
  // the entire point of being here. The cookie only suppresses the redirect;
  // the live 'manage' grant is what actually admits them, re-checked on the
  // page itself via getActingFor, so a forged cookie reaches an empty account
  // rather than somebody's record.
  const hasOpenAccount = Boolean(request.cookies.get("th_acting_for")?.value);
  const supporterOnly =
    profile.role === "patient" && profile.receives_care === false && !hasOpenAccount;
  if (supporterOnly && pathname.startsWith("/patient")) {
    const allowed =
      pathname === "/patient/supporting" ||
      pathname.startsWith("/patient/supporting/") ||
      // Naming a next of kin and being named by someone are the same screen,
      // and linking is how a supporter gets connected in the first place.
      pathname === "/patient/family" ||
      pathname.startsWith("/patient/family/") ||
      // The three-way thread with the person they support and the care team.
      pathname === "/patient/messages" ||
      pathname.startsWith("/patient/messages/") ||
      // What they pay for other people, not a plan of their own.
      pathname === "/patient/subscription" ||
      pathname.startsWith("/patient/subscription/");
    if (!allowed) {
      return NextResponse.redirect(new URL("/patient/supporting", request.url));
    }
  }

  const home =
    supporterOnly && profile.role === "patient"
      ? "/patient/supporting"
      : getRoleHomePath(profile.role);

  // Auth-only public paths (login/signup) — not marketing pages
  if (isPublicPath(pathname) && pathname !== "/" && !isMarketingPath(pathname)) {
    // Somebody already signed in who clicks a "book a check" call to action
    // still meant to book a check. Sending them to their generic dashboard
    // silently drops that, so honour the intent for patients, who are the
    // only role the booking surface exists for. Any other role, or any
    // unrecognised intent, falls through to the normal role home.
    const intent = request.nextUrl.searchParams.get("intent");
    if (intent === "health_check" && profile.role === "patient") {
      return NextResponse.redirect(
        new URL("/patient/prevention#health-check", request.url)
      );
    }
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
    // an assigned custom role) may enter the /admin or /finance area to reach
    // the specific surface they were granted — each page independently self-gates
    // on its own permission (hasPermission / is_finance), so this only opens the
    // door.
    const isDelegatableArea =
      pathname === "/admin" ||
      pathname.startsWith("/admin/") ||
      pathname === "/finance" ||
      pathname.startsWith("/finance/");
    if (isDelegatableArea) {
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
