import type { NextConfig } from "next";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // In a monorepo, trace files from the repo root so shared workspace
  // packages are correctly included in the production output.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Compile TypeScript sources imported from workspace packages.
  transpilePackages: ["@tarragon/shared", "@tarragon/lifestyle-engine"],
  async rewrites() {
    return [
      {
        // The Health Passport signing keys, at the conventional discovery path.
        // A rewrite rather than an `app/.well-known/` directory: a leading dot
        // makes a folder invisible to a fair amount of tooling (and to Next's
        // own file tracing), and the one URL an outside institution is told to
        // depend on for the next decade should not rest on that.
        source: "/.well-known/tarragon-passport-keys.json",
        destination: "/api/passport-keys",
      },
      {
        // The short form printed in the QR and read down phone lines. Every
        // character saved makes the printed code less dense and easier to scan
        // off a photocopy, which is the condition it will most often be in.
        source: "/v/:serial",
        destination: "/verify/:serial",
      },
    ];
  },
  // The brand lockup is read off disk at PDF render time (see
  // lib/health-passport/brand-assets.ts), so it must be traced into the
  // serverless bundle — it is never imported, only opened by path, which
  // tracing cannot infer on its own. A missing file degrades to a typeset
  // wordmark, so this is a quality guard rather than a correctness one.
  outputFileTracingIncludes: {
    "/api/patient/health-passport/pdf": ["./public/brand/guard-leaf-lockup.png"],
    "/api/patient/health-check/report": ["./public/brand/guard-leaf-lockup.png"],
    "/api/patient/quarterly-report/pdf": ["./public/brand/guard-leaf-lockup.png"],
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
