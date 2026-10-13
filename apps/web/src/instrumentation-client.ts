import * as Sentry from "@sentry/nextjs";
import { buildSentryOptions } from "@/lib/sentry/options";

/**
 * Optional, browser-side. Unset NEXT_PUBLIC_SENTRY_DSN means Sentry.init()
 * is never called — same opt-in pattern as sentry.server.config.ts. A DSN
 * is not a secret (it's designed to be public/bundled client-side), but it
 * still needs the NEXT_PUBLIC_ prefix to reach the browser bundle per
 * CLAUDE.md's env var rule. The sample rate is read from NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE (browser bundles only see NEXT_PUBLIC_ vars).
 */
const options = buildSentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN, {
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV,
  nodeEnv: process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  sampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
});
if (options) Sentry.init(options);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
