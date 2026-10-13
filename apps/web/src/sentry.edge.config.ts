import * as Sentry from "@sentry/nextjs";
import { buildSentryOptions } from "@/lib/sentry/options";

/**
 * Optional. Unset SENTRY_DSN means Sentry.init() is never called — same
 * opt-in pattern as sentry.server.config.ts and services/ml.
 */
const options = buildSentryOptions(process.env.SENTRY_DSN, {
  environment: process.env.VERCEL_ENV,
  nodeEnv: process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA,
  sampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE,
});
if (options) Sentry.init(options);
