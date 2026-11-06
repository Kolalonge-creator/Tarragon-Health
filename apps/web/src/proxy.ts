import { NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import {
  getRoleHomePath,
  isPublicPath,
  isRoleHomePrefixed,
  pathMatchesRole,
} from "@/lib/auth/roles";
import { isAppHost, wwwRedirectTarget } from "@/lib/marketing/host";
import { isMarketingPath } from "@/lib/marketing/routes";
import { consoleBaseUrl, consoleRedirectTarget } from "@/lib/console-redirect";
import { rateLimit } from "@/lib/rate-limit";
import { JOIN_PATH_PREFIX, isJoinToken, joinLandingPath } from "@/lib/care-circle/join-link";
import { isMobileApiPath, isSafetyRoute, mobileApiRateLimitResponse } from "@/lib/mobile-api-rate-limit";
import { appCheckShouldRefuse } from "@/lib/app-check/verify";
import {
  MFA_SETUP_PATH,
  aalFromAccessToken,
  anyMfaGroupRequired,
  isMfaRequiredForCaller,
  readMyMfaRequirement,
  requestAccessToken,
  mfaEnrolmentVerdict,
} from "@tarragon/auth/mfa-policy";
import { createBearerClient } from "@/lib/supabase/bearer";
import { isConsultationCallPath, newCspNonce } from "@/lib/security/csp-nonce";
import { buildCsp } from "@/lib/security/csp-policy";

/**
 * For the phone app: is the caller in a required group without an AAL2 token? Unlike the cookie gate, an account WITH a factor
 * is refused too: the phone app cannot run the challenge, and an AAL1 token from an account with a factor is exactly what a
 * stolen password produces. Lookup failures pass through (see the call site).
 */
async function isMfaRequiredForPhoneCaller(token: string): Promise<boolean> {
  try {
    const client = createBearerClient(token);
    if ((await anyMfaGroupRequired(client)) === false) return false;
    return (await readMyMfaRequirement(client)) === true;
  } catch {
    // A lookup that throws passes through, like one that errors: the route still verifies the token itself.
    return false;
  }
}

// Next.js 16 renamed `middleware.ts` -> `proxy.ts` (same file-convention
// contract, function must be named/exported `proxy`).
//
// The wrapper adds the REPORT-ONLY nonce script policy (lib/security/csp-nonce.ts) to app-host pages. The nonce goes on the
// REQUEST header (plain name) so Next stamps it on the scripts it renders (updateSession forwards the request headers), and on the RESPONSE so
// the browser reports what a strict policy would block. The enforced policy from next.config.ts is untouched.
export async function proxy(request: NextRequest) {
  // www.* is never canonical: one permanent hop to the bare host, path and
  // query kept (website Phase 5). First, so nothing else runs twice.
  const bareHost = wwwRedirectTarget(
    request.url,
    request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  );
  if (bareHost) {
    return NextResponse.redirect(bareHost, 308);
  }

  const host = request.headers.get("host") ?? "";
  if (!isAppHost(host)) return proxyInner(request);

  // App host: ONE enforced Content-Security-Policy with a fresh nonce, set here on every response (next.config sends its static
  // policy to the marketing host only; see lib/security/csp-policy.ts for why two policies cannot coexist on Vercel). Next reads the
  // nonce from the request's CSP header and stamps it on every script it renders, so the policy goes on the forwarded request too.
  const { pathname } = request.nextUrl;
  const policy = buildCsp({
    inAppCall: isConsultationCallPath(pathname),
    nonce: newCspNonce(),
    dev: process.env.NODE_ENV === "development",
  });
  let forwardedRequest = request;
  // Page loads only (GET/HEAD) get a rebuilt request: that is where Next renders scripts, and a POST (a server action) keeps its
  // body untouched. A new request with CLONED headers is Vercel's documented way to forward a header.
  if (request.method === "GET" || request.method === "HEAD") {
    const forwarded = new Headers(request.headers);
    forwarded.set("content-security-policy", policy);
    forwardedRequest = new NextRequest(request.url, { method: request.method, headers: forwarded });
  }
  const response = await proxyInner(forwardedRequest);
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

async function proxyInner(request: NextRequest) {
  // Staff areas that have moved to apps/console (S01d). Runs before anything
  // else: it needs no session, and a stale bookmark, email link or stored
  // notification row pointing at an old `app.` staff path should land on the
  // same page on the console host. 307, not 308, while the console is new:
  // a browser caches a 308 indefinitely, which would make rolling this back
  // unrecoverable for anyone who already followed a link. Opt-in per
  // environment via CONSOLE_BASE_URL, so shipping this before the console is
  // live redirects nobody.
  const consoleTarget = consoleRedirectTarget(
    request.nextUrl.pathname,
    request.nextUrl.search,
    consoleBaseUrl()
  );
  if (consoleTarget) {
    return NextResponse.redirect(consoleTarget, 307);
  }

  // OQ-267: one request-rate limit for every /api/mobile/* route, before any session work. Generous and fail-open; see
  // lib/mobile-api-rate-limit.ts for why it is keyed on the session, not the IP.
  if (isMobileApiPath(request.nextUrl.pathname)) {
    const limited = await mobileApiRateLimitResponse(request.headers, rateLimit, request.nextUrl.pathname);
    if (limited) return limited;
    // Firebase App Check (Play Integrity) for the Android app. MONITOR mode by default: logs, never refuses
    // (lib/app-check/verify.ts). Even under enforce, a safety route is never refused: a delay there could delay care.
    if (!isSafetyRoute(request.nextUrl.pathname) && (await appCheckShouldRefuse(request.headers, request.nextUrl.pathname))) {
      // 403, never 401: the app reads a 401 as an expired session, refreshes, and signs the person out.
      return NextResponse.json(
        { error: "This app could not be verified. Update TarragonHealth from the Play Store and try again.", code: "app_check_failed" },
        { status: 403 },
      );
    }
    // 2FA required per group, for the phone app. Its routes authenticate with a bearer token, never a cookie, so the cookie gate
    // further down never sees them. A token whose own `aal` claim says AAL2 needs no lookup (a forged one is refused by the
    // route when it verifies the signature). Otherwise the caller's group is asked; a lookup that fails passes through, because
    // that is most often an expired token, which the route answers with the 401 the app refreshes on. Sending to a safety
    // route is never refused, for the same reason as App Check above. The phone app has no 2FA set-up or challenge screens yet, so while a
    // group is required its members cannot use the phone app beyond its safety features (the admin page says so).
    // The token is found the way the routes find it: the Authorization header, then ?token= (the PDF and image routes the app
    // opens in a browser view). Reading only the header let an AAL1 token in the query string skip this gate.
    const token = requestAccessToken(request.headers, request.nextUrl.searchParams);
    // Every request to a safety route is exempt, whatever the method: the symptom checker reads its open state and the
    // check-backs due with a GET, and refusing those would close the checker and hide follow-ups from a held patient. None of
    // the safety routes returns record history (checked 2026-11-05: vitals, device and CGM readings accept POST only).
    const safetyExempt = isSafetyRoute(request.nextUrl.pathname);
    if (token && !safetyExempt && aalFromAccessToken(token) !== "aal2") {
      const mustEnrolOrChallenge = await isMfaRequiredForPhoneCaller(token);
      if (mustEnrolOrChallenge) {
        return NextResponse.json(
          {
            error: "Your account needs two-factor sign-in. Sign in on the TarragonHealth website to set it up, then use the app.",
            code: "mfa_required",
          },
          { status: 403 },
        );
      }
    }
  }

  const { response, supabase, user } = await updateSession(request, { verify: "claims" });
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

  // Independent verification of an issued outcomes report, for a board member
  // or auditor holding a printout who has no account and should not need one.
  // Exits here for the same two reasons /emergency/ does: it needs no session
  // (so none of the role gating below applies), and it must not be caught by
  // the isPublicPath branch further down, which would bounce an ALREADY
  // signed-in visitor to their own dashboard — a Tarragon or payer staff
  // member checking a document somebody handed them is exactly who follows
  // this link. The report number and verification code travel as query
  // parameters, so no-referrer keeps them out of any outbound Referer header.
  // The function behind the page discloses no figure from the report, whoever
  // calls it.
  if (pathname === "/verify-report") {
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }

  // Where Paystack returns whoever paid a Care Coordinator's phone-booking pay link. That person may be a relative with no account,
  // or a patient who is not signed in on this device, and a signed-in one must not be bounced to a dashboard. The page shows no
  // patient data at all: it only says the payment went through.
  if (pathname === "/payment-received") {
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }

  // No-login prescription check (QR on the prescription PDF). Same reasoning as /emergency/ and
  // /verify-report: it needs no session, must not bounce a signed-in visitor (a pharmacist who is also a
  // user), and the 64-hex token in the path must never leave through a Referer header.
  // T2 Phase 3: the no-login check of a printed test request form (QR on the request PDF). Same reasoning.
  if (pathname === "/verify-rx" || pathname.startsWith("/verify-rx/") || pathname === "/verify-request" || pathname.startsWith("/verify-request/")) {
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }

  // The signed-out landing for a Care Circle invite link (supporter join path). The token in the path is the only key to it, the page
  // needs no session (a relative abroad opens it before they have an account), a signed-in visitor is sent on to the real join page
  // by the page itself, and the token must never leave through a Referer header.
  if (pathname.startsWith("/circle/join/")) {
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }

  // Time-limited record share link. Same reasoning as /emergency/: the token
  // in the URL is the sole authorisation, the page needs no session, a
  // signed-in user clicking the link must land on the share page (not be
  // bounced to their dashboard by the role-gating branch below), and the
  // token must never leak via a Referer header.
  if (pathname.startsWith("/share/")) {
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }

  // A supporter's payment request link (S72, 19.13). The code in the path is the whole authorisation to see the generic item and price, the page needs no
  // role (a signed-in visitor must land on it, not be bounced to a dashboard), and the code must never leave through a Referer header.
  if (pathname.startsWith("/checkout/pr_")) {
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
  // The assurance level is kept for the 2FA group requirement further down.
  let mfaNextLevel: string | undefined;
  if (user && pathname !== "/login/mfa-challenge" && !pathname.startsWith("/auth/")) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    mfaNextLevel = aal?.nextLevel ?? undefined;
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel) {
      const challengeUrl = new URL("/login/mfa-challenge", request.url);
      // Keep the query: a signed document link (/d/<kind>/<id>?e=..&s=..) is useless without it (OQ-336). The challenge page sanitises it.
      challengeUrl.searchParams.set("redirect", `${pathname}${request.nextUrl.search}`);
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

  // Marketing pages live on the root domain only. Without this every one of
  // them is also reachable, and crawlable, on app.* — a duplicate of the whole
  // public site, saved from an indexing penalty only by the canonical tags.
  //
  // Deliberately placed AFTER the `pathname === "/"` branch above: "/" is a
  // legitimate platform entry point on the app host and must keep resolving to
  // the role home. 308 rather than 307 so the permanence is a real signal to a
  // crawler. `url.port` is left intact so app.localhost:3000 redirects to
  // localhost:3000 in development rather than to port 80.
  if (isApp && pathname !== "/" && isMarketingPath(pathname)) {
    const url = new URL(request.url);
    url.hostname = url.hostname.replace(/^app\./, "");
    return NextResponse.redirect(url, 308);
  }

  if (!user) {
    // A Care Circle link opened while signed out goes to its landing (who invited you, what you will see, a supporter sign-up), not to
    // a bare sign-in form. Only a well-formed token is carried; anything else falls through to the ordinary sign-in redirect.
    const joinToken = pathname.startsWith(JOIN_PATH_PREFIX) ? pathname.slice(JOIN_PATH_PREFIX.length) : null;
    if (joinToken !== null && isJoinToken(joinToken)) {
      const landing = NextResponse.redirect(new URL(joinLandingPath(joinToken), request.url));
      landing.headers.set("Referrer-Policy", "no-referrer");
      return landing;
    }
    if (isRoleHomePrefixed(pathname)) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  // Role authorisation is derived from `profiles`, never from JWT metadata
  // (which is user-editable) — mirrors the RLS helper functions in
  // supabase/migrations/20260705000001_core_auth_multitenancy.sql.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, custom_role_id, receives_care")
    .eq("id", user.id)
    .single();

  // Fail CLOSED. An unreadable profile row is not a licence to continue: the
  // whole block below (supporter default-deny, role-area matching, the
  // delegated-permission checks) derives entirely from this row, so letting
  // the request through with `profile` null silently skips every one of
  // them. The row can be unreadable for boring reasons (a Supabase blip, an
  // account provisioned in auth but not yet in `profiles`) and for
  // interesting ones — none of which are reasons to hand out an unfiltered
  // response. Same disposition as the signed-in-but-no-profile branch on the
  // app-host "/" entry above, which already redirects to /login.
  //
  // Public paths are exempt for the obvious reason: bouncing /login itself to
  // /login is an infinite redirect, and marketing/auth-callback pages need no
  // role at all.
  if (!profile) {
    if (isPublicPath(pathname)) {
      return response;
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 2FA required per group (admin switch at /admin/settings/two-factor, every group ships OFF; @tarragon/auth/mfa-policy). An
  // account whose group requires 2FA and that has no verified factor reaches only Profile & settings, the challenge page, the
  // auth callbacks and the public pages (so it can always sign out); an /api call gets a 403. One WITH a factor was already sent
  // to the challenge by the step-up gate above. Public and marketing paths are skipped before the database is asked, and so is
  // an account with a factor. The roles with a group on are cached per instance, so an account whose role has no group on costs
  // no per-request lookup at all, even while another group is on. The
  // database holds the same line independently (private.is_org_staff / is_admin / has_emergency_access).
  if (mfaNextLevel !== "aal2" && !isPublicPath(pathname)) {
    const required = await isMfaRequiredForCaller(supabase, Date.now(), "required", profile.role);
    const verdict = mfaEnrolmentVerdict({ pathname, required, nextLevel: mfaNextLevel });
    if (verdict === "refuse_api") {
      return NextResponse.json(
        { error: "Turn on two-factor sign-in in Profile & settings to continue.", code: "mfa_enrolment_required" },
        { status: 403 },
      );
    }
    if (verdict === "setup") {
      const setupUrl = new URL(MFA_SETUP_PATH, request.url);
      setupUrl.searchParams.set("mfa", "required");
      // Keep the destination, query included (a signed document link is useless without it, OQ-336). /account sanitises it.
      setupUrl.searchParams.set("redirect", `${pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(setupUrl);
    }
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
      pathname.startsWith("/patient/subscription/") ||
      // Where Paystack sends a payer back after they pay for a loved one (S29). Only the status page, never the shop for themselves.
      pathname === "/patient/membership/paid" ||
      // Paying for a group's screening day is the same "I pay, they receive" shape; the page says any patient account, support-only
      // included, can request one, and the supporter menu links to it.
      pathname === "/patient/screening-days";
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
    // A clinician who holds a community grant follows the overdue-work notice to the coordinator
    // address; send them to their own moderation desk instead of home.
    if (
      profile.role === "clinician" &&
      (pathname === "/dashboard/care-coordinator/community" || pathname.startsWith("/dashboard/care-coordinator/community/"))
    ) {
      return NextResponse.redirect(new URL("/clinician/community/moderation", request.url));
    }
    const isCoordinatorClinicianPath =
      profile.role === "care_coordinator" &&
      [
        "/clinician/patients",
        "/clinician/messages",
        "/clinician/escalations",
        "/clinician/orders",
        "/clinician/support-tickets",
        "/clinician/complaints",
        "/clinician/safety-incidents",
        // Added 2026-09-05. Both were in the Coordinator's sidebar and not on
        // this list, so they bounced with no explanation. Each was checked
        // against CLAUDE.md's rule that a Coordinator never gains write access
        // to medications, escalation resolution or protocol signing, and
        // neither does:
        //   - operations-queue is read-only by construction (no mutation, no
        //     form, no server action anywhere in the route).
        //   - medication-issues self-gates the clinical half in the page
        //     itself (`canResolveConcerns = isClinicalTier(staff)`), and its
        //     own docstring records that any org staff may see and raise both,
        //     while "care coordinator intervention" is a valid resolution for
        //     an affordability report specifically (Pharmacy Engine §12.16).
        // The list stays a fixed allow-list rather than a /clinician/* prefix
        // for the reason given above.
        "/clinician/operations-queue",
        "/clinician/medication-issues",
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
      // There is deliberately NO `missing:` clause here, and none may be
      // added. It used to carry `missing: [{header next-router-prefetch},
      // {header purpose=prefetch}]` to spare Next's own Link-hover/viewport
      // prefetches the getUser() round-trip this function makes. Per the
      // Next 16 proxy reference (matcher → `missing`: "conditions where
      // certain request elements are absent"), that means the proxy runs
      // ONLY when those headers are absent — and both are ordinary request
      // headers any client can send. `curl -H 'purpose: prefetch'` with a
      // stolen session cookie therefore skipped this whole function: the MFA
      // step-up gate above (the platform's only MFA enforcement point), the
      // supporter default-deny gate, and every role redirect. RLS still
      // stood behind it, but an authentication-strength control that a
      // header switches off is not a control.
      //
      // The prefetch cost it was buying is real but small and must be paid
      // elsewhere: a prefetch is a separate HTTP request, so React.cache
      // (which dedupes getCurrentUser within one render pass — see
      // lib/supabase/server.ts) cannot help across them, and nothing here may
      // cache an authorisation decision — a proxy-level cache is keyed by
      // path, not by caller, so a hit would answer one user's request with
      // another user's verdict. Next's own authentication guide describes
      // exactly this shape (proxy runs on every route including prefetched
      // ones; keep the check cheap and cookie-shaped) rather than skipping
      // the proxy. If prefetch fan-out ever becomes a measured problem, cut
      // the fan-out (prefetch={false} on the offending nav) — never the gate.
      //
      // `api/health/` (SR1, the secret-authenticated deep health check) is excluded for the same reason as `api/status` below:
      // it must answer when Supabase Auth is the thing that is down.
      //
      // `api/csp-report` takes anonymous browser violation reports (lib/security/csp-nonce.ts): it needs no session, and running
      // the 2FA gate on it would 403 and drop reports from held staff accounts.
      //
      // `api/status` is excluded for a different reason: it exists to
      // report whether Supabase Auth itself is degraded (see
      // docs/BUSINESS_CONTINUITY_DR_SPEC.md). updateSession()'s
      // auth.getUser() call has no timeout — routing this check through it
      // would let a slow/down Auth service hang the health check instead of
      // letting it report the outage, defeating the one check meant to
      // catch exactly that.
      source: "/((?!_next/static|_next/image|favicon.ico|api/status|api/health/|api/csp-report|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    },
  ],
};
