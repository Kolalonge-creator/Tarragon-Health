import * as Sentry from "@sentry/nextjs";

/**
 * Optional. Unset SENTRY_DSN means Sentry.init() is never called — same
 * opt-in pattern as sentry.server.config.ts and services/ml.
 */
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 1.0,
  });
}
