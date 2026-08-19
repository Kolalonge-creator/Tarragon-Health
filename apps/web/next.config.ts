import type { NextConfig } from "next";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";

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
