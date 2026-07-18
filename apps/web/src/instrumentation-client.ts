import * as Sentry from "@sentry/nextjs";

/**
 * Optional, browser-side. Unset NEXT_PUBLIC_SENTRY_DSN means Sentry.init()
 * is never called — same opt-in pattern as sentry.server.config.ts. A DSN
 * is not a secret (it's designed to be public/bundled client-side), but it
 * still needs the NEXT_PUBLIC_ prefix to reach the browser bundle per
 * CLAUDE.md's env var rule.
 */
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 1.0,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
