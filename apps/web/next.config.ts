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
const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: " + supabaseOrigin,
  "font-src 'self'",
  [
    "connect-src 'self'",
    supabaseOrigin,
    supabaseWebSocketOrigin,
    "https://*.ingest.us.sentry.io",
    "https://*.ingest.de.sentry.io",
    "https://*.ingest.sentry.io",
  ].join(" "),
  `frame-src ${supabaseOrigin} https://www.youtube-nocookie.com`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // In a monorepo, trace files from the repo root so shared workspace
  // packages are correctly included in the production output.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Compile TypeScript sources imported from workspace packages.
  transpilePackages: ["@tarragon/shared", "@tarragon/lifestyle-engine"],
  // Dev-server-only (ignored in production builds). The Expo mobile app's
  // WebView sections (apps/mobile/src/screens/webview-screen.tsx) hit this
  // dev server over the LAN IP set in apps/mobile/.env's
  // EXPO_PUBLIC_PLATFORM_URL — without this, Next refuses cross-origin
  // requests to its own dev resources (_next/webpack-hmr, static chunks)
  // from that origin, which silently prevents client-side JS from
  // hydrating at all (a page can look loaded — server-rendered markup
  // shows — while every useEffect never runs).
  allowedDevOrigins: ["192.168.40.137"],
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
