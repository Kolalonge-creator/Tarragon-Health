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

  // The mobile app's WebView session bridge (apps/mobile/src/screens/
  // webview-screen.tsx) must run its own client-side setSession() exchange
  // and `next` redirect every time it's hit — authenticated or not. Without
  // this, the isPublicPath() branch below (which exists to bounce an
  // already-signed-in visitor away from /auth/callback and friends) would
  // intercept every WebView open *after* the first — once sharedCookiesEnabled
  // has carried a cookie over from an earlier bridge visit, this route would
  // otherwise redirect straight to the role home before the page's own JS,
  // and the fresh token pair + intended `next` path, ever got a chance to run.
  if (pathname === "/auth/mobile-bridge") {
    return response;
  }

  // MFA step-up gate. Only fires for a caller who has already verified a
  // TOTP factor (self-enrolled via /account) and whose current session
  // hasn't completed the challenge yet — everyone who hasn't turned MFA on
  // is completely unaffected. Without this, /login/mfa-challenge would be
  // pure decoration: Supabase issues a valid aal1 session the instant a
  // password/OTP check passes, so anyone who knew just the password could
  // reach a dashboard directly and skip the challenge page entirely. This is
  // the single choke point for it, same reasoning as the supporter-only gate
  // below — a per-page check would have to be remembered everywhere a
  // protected route is added. `/auth/*` is exempt because those routes are
  // themselves mid-flow token exchanges (email confirm, mobile bridge) that
  // must be allowed to complete.
  if (user && pathname !== "/login/mfa-challenge" && !pathname.startsWith("/auth/")) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel) {
      const challengeUrl = new URL("/login/mfa-challenge", request.url);
      challengeUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(challengeUrl);
    }
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
    // A Care Coordinator's own home is /dashboard/care-coordinator, so
    // /clinician/* is "somebody else's role home" as far as isRoleHomePrefixed
    // is concerned — without this exception every /clinician/* link a
    // Coordinator's nav offers (lib/navigation.ts) bounces straight back here,
    // including the pre-existing Orders/Support inbox links, not just the
    // Patients/Patient messages/Escalations links added alongside this
    // exception. Deliberately a fixed allow-list, not "any /clinician/*
    // path": a Coordinator must never reach clinical-judgment-only surfaces
    // like care-plan review or medication reviews just because they share the
    // /clinician/ prefix. Each listed page still self-gates any
    // clinician-only action server-side (isClinicalTier, doctor-tier.ts) —
    // this only opens the door, same division of labour as isDelegatableArea
    // below.
    const isCoordinatorClinicianPath =
      profile.role === "care_coordinator" &&
      [
        "/clinician/patients",
        "/clinician/messages",
        "/clinician/escalations",
        "/clinician/orders",
        "/clinician/support-inbox",
        "/clinician/incident-reports",
      ].some((allowed) => pathname === allowed || pathname.startsWith(`${allowed}/`));
    if (isCoordinatorClinicianPath) {
      return response;
    }

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
      // `/.well-known/*` is excluded outright: those files are read by
      // machines that are never signed in (Paystack/Apple fetching
      // apple-developer-merchantid-domain-association to verify the domain
      // owns its Apple Pay merchant ID). Running the session/role logic on
      // them buys nothing and couples domain verification to Supabase Auth
      // being reachable — a proxy error there turns a plain static file into
      // a 500 and fails verification for a reason that has nothing to do
      // with the file.
      // `missing` skips proxy entirely for Next's own Link-hover/viewport
      // prefetch requests — every prefetched dashboard link independently
      // ran this function's getUser() Supabase call, and a page with N
      // links produced N concurrent Auth API calls per render. Real
      // navigations never carry these headers, so page-level auth checks
      // (layout.tsx, RLS) remain the enforcement boundary either way.
      source: "/((?!_next/static|_next/image|favicon.ico|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
