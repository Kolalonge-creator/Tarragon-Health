import * as Sentry from "@sentry/nextjs";

/**
 * Optional. Unset SENTRY_DSN means Sentry.init() is never called, so any
 * environment without the var (local dev by default) runs with zero Sentry
 * activity — same opt-in pattern as services/ml (see app/main.py).
 */
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 1.0,
  });
}
