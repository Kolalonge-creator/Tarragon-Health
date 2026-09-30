import type { NextConfig } from "next";
import path from "node:path";

// The staff console is a separate deployment on its own host (S01d, founder
// decision F-04) precisely so it can carry a stricter posture than the public
// site and patient dashboard in apps/web. Every difference from
// apps/web/next.config.ts is deliberate:
//
//   frame-ancestors 'none' + X-Frame-Options DENY — no page here is ever
//     framed, by anyone. (apps/web allows 'self'.)
//   no YouTube frame-src, no marketing origins — nothing public is served
//     from this host.
//   Referrer-Policy no-referrer — console URLs carry patient and record ids
//     in their paths; none of that may leak to a linked site.
//   Cache-Control no-store on every page — a staff screen is PHI, and must
//     not be recoverable from a shared machine's back/forward or disk cache.
//   Permissions-Policy denies camera, microphone and geolocation. The
//     clinician video-visit host page needs camera and microphone when that
//     area is extracted; grant it then, on that path only, never globally.
//   X-Robots-Tag noindex — this host must never appear in a search index.
//   COOP/CORP same-origin — isolates the browsing context from any window
//     that opened it.
//
// 'unsafe-inline' for script/style stays for the same reason documented in
// apps/web/next.config.ts: App Router inlines its RSC payload, and removing
// it needs per-request nonces (a separate architectural change).
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
  // Signed Storage URLs shown in an <iframe> (lab and ECG report panels).
  `frame-src ${supabaseOrigin}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../../"),
  poweredByHeader: false,
  transpilePackages: ["@tarragon/shared", "@tarragon/i18n", "@tarragon/ui", "@tarragon/auth", "@tarragon/staff-core"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // Dev-server only: the Playwright suite reaches the dev server at 127.0.0.1.
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Content-Security-Policy", value: cspDirectives },
        ],
      },
      {
        // Everything except the immutable build assets, which must stay
        // cacheable or every page load re-downloads the whole bundle.
        source: "/((?!_next/static|_next/image).*)",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
