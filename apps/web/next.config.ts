import type { NextConfig } from "next";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";

// Derived from NEXT_PUBLIC_SUPABASE_URL rather than hardcoded, so a local
// dev/staging Supabase project (or a future project migration) doesn't
// silently leave the CSP pointed at the wrong host. Falls back to the one
// true go-forward project (CLAUDE.md: koiplnmbgnqnbywhpjlf) so the policy is
// still correct for a production build even if the env var isn't threaded
// through at build time.
function getSupabaseOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (raw) {
    try {
      return new URL(raw).origin;
    } catch {
      // fall through to the default below
    }
  }
  return "https://koiplnmbgnqnbywhpjlf.supabase.co";
}

const supabaseOrigin = getSupabaseOrigin();
const supabaseWebSocketOrigin = supabaseOrigin.replace(/^https:/, "wss:");

// Content-Security-Policy, built from an actual inventory of every external
// resource this app loads or embeds (see the PR description for the file-by-
// file evidence). Kept enforcing, not report-only.
//
//   script-src/style-src 'unsafe-inline' — Next.js App Router streams RSC
//   payloads into the client via inline `<script>self.__next_f.push(...)`
//   tags on every page (not just Suspense-boundary pages); there is no way
//   to avoid this without a per-request nonce, which in turn forces every
//   page (including the marketing site, currently statically generated) into
//   fully dynamic rendering — a materially bigger, separate architectural
//   change than this headers pass. Confirmed live: removing 'unsafe-inline'
//   from script-src breaks hydration on every page (console errors, dead
//   useEffects). style-src needs it too — inline `style={{...}}` attributes
//   are pervasive throughout the app (progress bars, dynamic widths/colors)
//   and CSP has no nonce mechanism for the `style=""` attribute in React.
//   img-src — 'self' (local/static assets, /brand, /marketing), data:
//   (MFA TOTP QR code, account/mfa-settings-card.tsx), blob: (local file
//   preview before upload: avatar-upload-form.tsx, clinical-staff-manager.tsx,
//   supported-people.tsx, analytics/download-csv.ts), plus the Supabase
//   project origin (avatar.tsx renders `photoUrl` — an arbitrary Storage URL
//   — directly in an <img>).
//   font-src — 'self' only. next/font/google (Sora, Inter — see
//   src/app/layout.tsx) self-hosts the font files at build time; there is no
//   runtime request to fonts.googleapis.com/fonts.gstatic.com to allow.
//   connect-src — the Supabase project (REST/Auth over https, Realtime over
//   wss — src/lib/supabase/client.ts is a real browser client), plus Sentry's
//   ingest hosts. Browser-side Sentry is real but optional
//   (instrumentation-client.ts, gated on NEXT_PUBLIC_SENTRY_DSN, unset in
//   every checked-in env file) — the exact ingest subdomain is derived from
//   whatever DSN gets configured, so this allows Sentry's ingest host
//   patterns for both its regions rather than guessing one project ID.
//   frame-src — the Supabase project origin (ecg-report-extraction-panel.tsx
//   and lab-report-extraction-panel.tsx embed a signed Storage URL in an
//   <iframe> to show the source document) and youtube-nocookie.com
//   (marketing-video.tsx embeds a YouTube video on the marketing site).
//   Paystack, Stripe, Zoom, and every wearable OAuth provider (Oura/WHOOP/
//   Garmin/Fitbit/Dexcom) are deliberately absent: every one of those is a
//   server-issued 307/302 redirect (paystack/transactions.ts,
//   stripe/checkout.ts, wearables/oauth-providers.ts's getWearableOAuthUrl)
//   or a plain `<a target="_blank">` (the Zoom join_url in
//   video-visit waiting-room.tsx) — top-level browser navigation, which CSP
//   does not govern (no script/iframe/fetch touches those domains from our
//   page). Server-only clients (paystack/client.ts, stripe/client.ts,
//   zoom/client.ts, twilio/proxy-client.ts, identity/provider.ts,
//   wearables/token-exchange.ts, lifestyle/voyage-embedder.ts, Termii) all
//   carry `import "server-only"` or an explicit "never import from a 'use
//   client' file" comment and run on the Node/Edge server, never the
//   browser, so they need no CSP entry either.
// The in-app Zoom call (S21 follow-up, OQ-136) needs more than the rest of the app, so the extra allowances are added ONLY on the two
// consultation routes (see headers() below) and nowhere else. They are Zoom's own hosts: its Meeting SDK script and assets
// (source.zoom.us at the pinned SDK version's path only: the only place allowed to supply SCRIPT, and no blob: scripts, because these pages carry the most sensitive data), its
// signalling and media over https and wss (*.zoom.us, and *.zoom.com for its new domain), blob: for the media and workers the SDK
// creates, and 'wasm-unsafe-eval' for its WebAssembly media engine (not 'unsafe-eval': nothing in the SDK bundle was found to need it).
// Evidence for leaving blob: out of script-src: in the 6.5.0 bundle the audio worklets are loaded by path from source.zoom.us
// (`audioWorkletPath`), and the blob URLs it creates feed an Audio element (media-src), not scripts; the SDK's workers are blob
// workers (worker-src) that importScripts from source.zoom.us. Not verified live.
// Anything narrower than this that a live call turns out to need (an iframe, a blob script, eval) is added HERE, one directive at a
// time, after a real violation report; until a live test the call falls back to the link if the SDK is blocked.
// Cross-origin isolation (COOP/COEP) is deliberately NOT turned on: it would break every other embed on these pages, and without it
// the SDK simply runs without SharedArrayBuffer (no gallery view, lower send resolution), which a one-to-one consultation does not need.
const zoomHosts = "https://*.zoom.us https://*.zoom.com";
// SCRIPT and WORKER code may come only from the one pinned SDK version's path on Zoom's host, not from anywhere on source.zoom.us.
// Keep this version equal to ZOOM_SDK_VERSION in src/lib/consultations/zoom-sdk.ts (csp.test.ts fails if they drift). A browser matches
// a path prefix only on the URL as requested, so a redirect to another path would be blocked: that is the intent.
const ZOOM_SDK_CODE_SOURCE = "https://source.zoom.us/6.5.0/";
function buildCsp(opts: { inAppCall: boolean }): string {
  const call = opts.inAppCall;
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'" + (call ? ` 'wasm-unsafe-eval' ${ZOOM_SDK_CODE_SOURCE}` : ""),
    "style-src 'self' 'unsafe-inline'" + (call ? " https://source.zoom.us" : ""),
    "img-src 'self' data: blob: " + supabaseOrigin + (call ? ` ${zoomHosts}` : ""),
    "font-src 'self'" + (call ? " data: https://source.zoom.us" : ""),
    call ? `media-src 'self' blob: ${zoomHosts}` : "",
    call ? `worker-src 'self' blob: ${ZOOM_SDK_CODE_SOURCE}` : "",
    [
      "connect-src 'self'",
      supabaseOrigin,
      supabaseWebSocketOrigin,
      "https://*.ingest.us.sentry.io",
      "https://*.ingest.de.sentry.io",
      "https://*.ingest.sentry.io",
      ...(call ? [zoomHosts, "wss://*.zoom.us", "wss://*.zoom.com"] : []),
    ].join(" "),
    `frame-src ${supabaseOrigin} https://www.youtube-nocookie.com`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ]
    .filter((d) => d.length > 0)
    .join("; ");
}
const cspDirectives = buildCsp({ inAppCall: false });
const consultationCspDirectives = buildCsp({ inAppCall: true });

const nextConfig: NextConfig = {
  // In a monorepo, trace files from the repo root so shared workspace
  // packages are correctly included in the production output.
  outputFileTracingRoot: path.join(__dirname, "../../"),
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
          { key: "Content-Security-Policy", value: cspDirectives },
        ],
      },
      {
        // The consultation rooms only. Declared after the rule above on purpose: when two rules set the same header on one path, the
        // last one wins (Next's "Header Overriding Behavior"), so these two routes get the wider policy and everything else keeps the
        // strict one.
        source: "/(patient|clinician)/consultation/:encounterId",
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
});
