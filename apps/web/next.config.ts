import type { NextConfig } from "next";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";
import { MARKETING_REDIRECTS } from "./src/lib/marketing/redirects";
import { buildCsp } from "./src/lib/security/csp-policy";

const cspDirectives = buildCsp({ inAppCall: false });
const consultationCspDirectives = buildCsp({ inAppCall: true });

const nextConfig: NextConfig = {
  // In a monorepo, trace files from the repo root so shared workspace
  // packages are correctly included in the production output.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Default is 60s per page. The build prerenders ~570 pages on a 2-core
  // machine with one worker, and a busy worker pushed otherwise healthy public
  // pages past 60s three production builds running (2026-10-17/18), failing the
  // whole deploy. Slow here means a late deploy, never a broken page.
  staticPageGenerationTimeout: 180,
  // Server Actions default to a 1MB request-body cap. Every form that
  // uploads a file straight through a Server Action (patient avatar, up to
  // 5MB per validatePatientAvatarFile; medicine-pack photos, up to 8MB) was
  // silently rejected by this cap before the handler ever ran, well below
  // what the UI advertised and validated client-side. Raised past the
  // largest of those, with the multipart overhead the docs call out.
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // Compile TypeScript sources imported from workspace packages.
  transpilePackages: ["@tarragon/shared", "@tarragon/ui", "@tarragon/auth", "@tarragon/i18n", "@tarragon/staff-core", "@tarragon/lifestyle-engine", "@tarragon/symptom-triage-engine", "@tarragon/medicines", "@tarragon/clinical", "@tarragon/commerce"],
  // Dev-server-only (ignored in production builds). Next auto-allows only
  // the exact hostname the dev server was initialized with (`localhost` by
  // default; see allowedDevOrigins docs) — every other origin needs to be
  // listed explicitly, or Next silently blocks cross-origin requests to its
  // own dev resources (_next/webpack-hmr, static chunks). Two real origins
  // hit this dev server: the Expo mobile app's WebView sections
  // (apps/mobile/src/screens/webview-screen.tsx) over the LAN IP set in
  // apps/mobile/.env's EXPO_PUBLIC_PLATFORM_URL, and Playwright's browser
  // E2E suite (apps/web/playwright.config.ts's BASE_URL defaults to
  // `http://127.0.0.1:...`, which is a different origin from `localhost` as
  // far as this check is concerned). Missing `127.0.0.1` here silently
  // broke the E2E suite: the initial server-rendered HTML still showed
  // (page "looked loaded"), but blocked static chunks meant client
  // components never hydrated — useQuery hooks never ran, so anything
  // gated on their loading state (e.g. onboarding's "I agree, continue"
  // button) stayed stuck disabled forever, confirmed live via CI on
  // 2026-09-23 (chunk-block warning in the dev-server log, screenshot
  // showing "Loading…" frozen with the checkbox already checked by
  // Playwright's raw DOM manipulation).
  allowedDevOrigins: ["192.168.40.137", "127.0.0.1"],
  // The marketing site's hero photography is 150-710 KB of source JPEG per
  // page, served to a market where mobile data is metered and often slow.
  // next/image already resizes, but with no `formats` set it re-encodes to
  // WebP only; adding AVIF ahead of it typically halves the transfer again
  // for the same photo, and browsers that support neither still get the
  // original via content negotiation. Ordered most-efficient-first, which is
  // the order Next offers them in the Accept negotiation.
  images: {
    formats: ["image/avif", "image/webp"],
  },
  // Marketing site URL changes (website upgrade, plan section 3.3). Permanent
  // (308/301) so search engines move the old page's standing to the new one.
  // Phase 3 (2026-11-05): /hmo folds into the Employers & Organisations page
  // (founder decision W-05). The full redirect map lands in Phase 5; the
  // map itself is in src/lib/marketing/redirects.ts, where a test checks it.
  async redirects() {
    return MARKETING_REDIRECTS.map((r) => ({ ...r, permanent: true }));
  },
  // Apple Pay domain verification for Paystack. The file lives at
  // public/.well-known/apple-developer-merchantid-domain-association and has
  // no file extension, so Next's static handler sets no Content-Type at all
  // and the fetcher is left to sniff a 228-character hex blob. Pin it to
  // text/plain so Paystack/Apple always read it as the text it is.
  async headers() {
    return [
      {
        source: "/.well-known/apple-developer-merchantid-domain-association",
        headers: [{ key: "Content-Type", value: "text/plain; charset=utf-8" }],
      },
      {
        // Applies to every route. src/proxy.ts (Next 16's middleware) sets
        // its own stricter `Referrer-Policy: no-referrer` for /emergency/*
        // (an anon-readable, token-in-URL page) — verified live that the
        // proxy's per-route header wins over this one for that path rather
        // than being overwritten by it.
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Safe for the Expo mobile app: webview-screen.tsx loads platform
          // pages via react-native-webview's `source={{ uri }}` as top-level
          // WebView navigation (like a mini in-app browser tab), not via an
          // HTML <iframe> — X-Frame-Options only restricts framing, so it
          // has no effect on that WebView's navigation.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            // camera+microphone: video-visit/[id]/waiting-room.tsx's
            // DeviceTest does a real getUserMedia({video, audio}) camera/mic
            // preview before a video visit. geolocation: pharmacy-catalogue.tsx
            // and facility-selector.tsx both call
            // navigator.geolocation.getCurrentPosition for "near me" search.
            // Everything else this spec lists (payment, usb, fullscreen, etc.)
            // has no usage in the codebase, so it's left off rather than
            // guessed at.
            value: "camera=(self), microphone=(self), geolocation=(self)",
          },
          // Vercel serves this app over HTTPS by default; safe to force it.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
      {
        // The static policy is for the MARKETING host only. On the app host src/proxy.ts sets one enforced policy with a fresh
        // nonce per request; a second policy from here would shadow its nonce on Vercel (see src/lib/security/csp-policy.ts).
        source: "/(.*)",
        missing: [{ type: "host", value: "app\\..*" }],
        headers: [{ key: "Content-Security-Policy", value: cspDirectives }],
      },
      {
        // Security audit 2026-11-05 (L-6): every signed-in area, and every page opened by a token in its link (emergency card,
        // shared records, verification links), is never kept by a browser, proxy or CDN, so a shared or public computer cannot show
        // the last person's health pages from cache. Declared after the catch-all and before the stricter per-page rules below,
        // which set the same header and so still win on their own paths.
        source:
          "/(patient|clinician|admin|account|analytics|credentialing|dashboard|doctor|finance|lab-liaison|lab-partner|payer|pharmacist|provider-org|reader|rota|onboarding|circle|emergency|share|claim|d|verify-report|verify-rx)/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
      },
      {
        // S36i: the speak-up screens show private words and who wrote them (spec INV-07). Never cached by a browser, a proxy or
        // the CDN, and the address is never sent on as a referrer. This entry comes after the catch-all above so it wins for these paths.
        source: "/clinician/(quality/concerns|my-concerns)",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        // S20 v2: the readers' screen and the clinician's own audit results. Separate entries: Next's matcher rejects nested capture groups.
        source: "/reader/concerns",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        source: "/clinician/my-quality",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        // S20 v2: an audit page shows clinical content read through an audited read. Never cached, never sent on as a referrer.
        source: "/clinician/quality/audits/:auditId",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        // The consultation rooms only. Declared after the rule above on purpose: when two rules set the same header on one path, the
        // last one wins (Next's "Header Overriding Behavior"), so these two routes get the wider policy and everything else keeps the
        // strict one.
        source: "/(patient|clinician)/consultation/:encounterId",
        missing: [{ type: "host", value: "app\\..*" }],
        headers: [{ key: "Content-Security-Policy", value: consultationCspDirectives }],
      },
      {
        // CGJ: the room an invited caregiver joins from. Same policy, one more path; the caregiver's room runs the same Zoom SDK.
        source: "/patient/supporting/consultation/:encounterId",
        missing: [{ type: "host", value: "app\\..*" }],
        headers: [{ key: "Content-Security-Policy", value: consultationCspDirectives }],
      },
    ];
  },
};

// withSentryConfig only affects the build (source map upload, tunnel
// route). It doesn't gate whether Sentry.init() runs at runtime — that's
// controlled entirely by SENTRY_DSN/NEXT_PUBLIC_SENTRY_DSN being set (see
// src/sentry.server.config.ts). Source map upload itself needs
// SENTRY_ORG/SENTRY_PROJECT/SENTRY_AUTH_TOKEN as build-time env vars and is
// silently skipped without them — safe to leave wrapped even before those
// are configured.
export default withSentryConfig(nextConfig, {
  silent: true,
  telemetry: false,
  // SR1: tag the build with the deploy's commit so an error is tied to the release that shipped it. Undefined locally
  // (no VERCEL_GIT_COMMIT_SHA), in which case the plugin falls back to its own default.
  release: process.env.VERCEL_GIT_COMMIT_SHA ? { name: process.env.VERCEL_GIT_COMMIT_SHA } : undefined,
});
