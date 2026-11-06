// The Content-Security-Policy, shared by next.config.ts (marketing host, static) and src/proxy.ts (app host, per request with a
// nonce). No "@/" imports here: next.config.ts imports this file directly.
//
// Step 2 of the nonce rollout (2026-11-06): on the app host the proxy sets ONE enforced policy whose script-src is a fresh nonce +
// 'strict-dynamic' instead of 'unsafe-inline'. It must be the only CSP on those responses: on Vercel the renderer receives the
// response policy as a request header, and Next reads the nonce from the first `content-security-policy` it sees, so a second,
// nonce-less policy from next.config shadowed it (probe 2026-11-06). next.config therefore sends its policy only when the host is NOT
// the app host. The marketing host keeps 'unsafe-inline': its pages are statically generated, so there is no request to carry a nonce.
//
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
// The Google Maps JavaScript API (@vis.gl/react-google-maps) draws the public /coverage partner map and powers the "Geocode" button on
// the admin partner-catalogue pages. Until 2026-11-04 this policy blocked maps.googleapis.com, so the map never loaded in production
// ("The Google Maps JavaScript API could not load") and the Geocode button stayed disabled. The hosts below are Google's documented
// Maps JS hosts, https only. They are in the GENERAL policy, not on those pages alone, on purpose: a browser fixes a page's CSP at the
// first full document load and keeps it through every client-side (next/link, router.push, server-action redirect) navigation after
// it, so a per-route policy is lost the moment someone clicks through to the map from another page (tried and reverted the same day).
// The cost is small because script-src already carries 'unsafe-inline' (see above), so naming one more script host adds no real
// XSS exposure. The browser key itself is restricted in Google Cloud to the Maps JavaScript and Geocoding APIs and to the
// tarragonhealth.ng / localhost referrers. The consultation rooms keep their own policy (no Maps on those pages).
const googleMapsScriptHosts = "https://maps.googleapis.com https://*.gstatic.com";
const googleMapsImageHosts = "https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.ggpht.com https://*.googleusercontent.com";
const googleMapsConnectHosts = "https://*.googleapis.com https://*.google.com https://*.gstatic.com";
export function buildCsp(opts: { inAppCall: boolean; nonce?: string; dev?: boolean }): string {
  const call = opts.inAppCall;
  const maps = !call;
  return [
    "default-src 'self'",
    opts.nonce
      ? // 'strict-dynamic' lets a nonced script load what it needs (Next's chunks, the Maps loader, the Zoom SDK), so browsers that
        // support it ignore the host list and 'unsafe-inline' that follow; those stay only as the fallback for older browsers.
        `script-src 'nonce-${opts.nonce}' 'strict-dynamic' 'self' 'unsafe-inline' https:` +
        (call ? ` 'wasm-unsafe-eval' ${ZOOM_SDK_CODE_SOURCE}` : "") +
        (maps ? ` ${googleMapsScriptHosts}` : "") +
        (opts.dev ? " 'unsafe-eval'" : "")
      : "script-src 'self' 'unsafe-inline'" + (call ? ` 'wasm-unsafe-eval' ${ZOOM_SDK_CODE_SOURCE}` : "") + (maps ? ` ${googleMapsScriptHosts}` : ""),
    "style-src 'self' 'unsafe-inline'" + (call ? " https://source.zoom.us" : "") + (maps ? " https://fonts.googleapis.com" : ""),
    "img-src 'self' data: blob: " + supabaseOrigin + (call ? ` ${zoomHosts}` : "") + (maps ? ` ${googleMapsImageHosts}` : ""),
    "font-src 'self'" + (call ? " data: https://source.zoom.us" : "") + (maps ? " https://fonts.gstatic.com" : ""),
    call ? `media-src 'self' blob: ${zoomHosts}` : "",
    call ? `worker-src 'self' blob: ${ZOOM_SDK_CODE_SOURCE}` : maps ? "worker-src 'self' blob:" : "",
    [
      "connect-src 'self'",
      supabaseOrigin,
      supabaseWebSocketOrigin,
      "https://*.ingest.us.sentry.io",
      "https://*.ingest.de.sentry.io",
      "https://*.ingest.sentry.io",
      ...(call ? [zoomHosts, "wss://*.zoom.us", "wss://*.zoom.com"] : []),
      ...(maps ? [googleMapsConnectHosts] : []),
    ].join(" "),
    `frame-src ${supabaseOrigin} https://www.youtube-nocookie.com`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    // A blocked script on the app host is reported (sanitised, see src/app/api/csp-report/route.ts).
    opts.nonce ? "report-uri /api/csp-report" : "",
  ]
    .filter((d) => d.length > 0)
    .join("; ");
}
