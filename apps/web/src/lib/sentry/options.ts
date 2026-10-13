import type { ErrorEvent } from "@sentry/nextjs";
import { scrubPiiBeforeSend } from "./scrub-pii";

/**
 * SR1: the one place Sentry's runtime options are built, shared by the server, edge and browser configs so the three
 * cannot drift. Sentry stays opt-in: a caller passes the DSN it read from its own environment variable and gets `null`
 * back when there is none, in which case it must not call Sentry.init().
 *
 * Environment variables (see .env.example, "Error tracking: Sentry"):
 *   SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN      the DSN (server+edge / browser)
 *   SENTRY_TRACES_SAMPLE_RATE                0 to 1, default 0.1. The earlier hard-coded 1.0 sent every request as a
 *                                            trace, which at launch volumes is a cost and a rate-limit problem, not insight.
 *   SENTRY_RELEASE / NEXT_PUBLIC_SENTRY_RELEASE   release name; defaults to the Vercel git commit sha so an error is
 *                                            tied to the deploy that shipped it (withSentryConfig also tags the build).
 */
export const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

export interface SentryRuntimeOptions {
  dsn: string;
  environment: string;
  release: string | undefined;
  tracesSampleRate: number;
  sendDefaultPii: false;
  beforeSend: (event: ErrorEvent) => ErrorEvent;
}

/** A rate outside 0..1, or anything that is not a number, falls back to the default rather than silently sampling everything or nothing. */
export function parseSampleRate(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_TRACES_SAMPLE_RATE;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : DEFAULT_TRACES_SAMPLE_RATE;
}

export function buildSentryOptions(
  dsn: string | undefined,
  env: { environment?: string; nodeEnv?: string; release?: string; sampleRate?: string },
): SentryRuntimeOptions | null {
  if (!dsn) return null;
  return {
    dsn,
    environment: env.environment || env.nodeEnv || "development",
    release: env.release || undefined,
    tracesSampleRate: parseSampleRate(env.sampleRate),
    sendDefaultPii: false,
    beforeSend: scrubPiiBeforeSend,
  };
}
