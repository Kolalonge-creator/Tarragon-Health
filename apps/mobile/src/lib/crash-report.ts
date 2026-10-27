/**
 * S88a: the JS-only crash reporter core. No native imports, so it is testable under Jest and OTA-safe.
 *
 * Ships dormant: with no DSN (EXPO_PUBLIC_SENTRY_DSN unset) `createCrashReporter` returns a reporter whose `capture` does
 * nothing at all, no network, no state. This is NOT a native crash reporter: a hard native crash or an ANR never reaches
 * JS, and there are no source maps. That needs the Sentry native SDK and an EAS build (see docs/design/S88a.md).
 *
 * Hard rules, each covered by a test:
 *  - an allowlist event: error type, scrubbed message, parsed stack frames, app version, runtime version, platform,
 *    OS version, a coarse device brand, and a random install id. Nothing else is ever attached. No user, no request,
 *    no breadcrumbs, no extra, no component stack.
 *  - never throws, never awaits on the caller's path: `capture` returns void and the send is fire and forget with a timeout.
 *  - never writes to disk: there is no retry queue. A report that fails to send is dropped.
 *  - rate limited and de-duplicated per process, so a render loop cannot flood Sentry or the radio.
 */
import { scrubErrorType, scrubMessage, scrubStack, type ScrubbedFrame } from "./crash-scrub";

export interface CrashContext {
  appVersion: string;
  runtimeVersion: string;
  platform: string;
  osVersion: string;
  /** Coarse device brand such as "TECNO", never a user-given device name. */
  deviceBrand: string;
  /** Random per install, never derived from a person or a device identifier. */
  installId: string;
  environment: string;
}

export interface CrashReporterOptions {
  dsn: string | undefined | null;
  context: CrashContext;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Events allowed per process. */
  maxEvents?: number;
  /** Minimum gap between two sends, ms. */
  minGapMs?: number;
  timeoutMs?: number;
}

export type CaptureSource = "global_handler" | "promise_rejection" | "error_boundary" | "manual";

export interface CrashReporter {
  readonly enabled: boolean;
  capture(error: unknown, source: CaptureSource, fatal?: boolean): void;
}

export interface ParsedDsn {
  endpoint: string;
  publicKey: string;
  dsn: string;
}

export function parseDsn(dsn: string | undefined | null): ParsedDsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, "");
    if (!u.username || !/^[0-9]+$/.test(projectId) || u.protocol !== "https:") return null;
    return { endpoint: `${u.protocol}//${u.host}/api/${projectId}/envelope/`, publicKey: u.username, dsn };
  } catch {
    return null;
  }
}

export interface CrashEvent {
  event_id: string;
  timestamp: number;
  platform: "javascript";
  level: "fatal" | "error";
  environment: string;
  release: string;
  dist: string;
  sdk: { name: string; version: string };
  tags: Record<string, string>;
  contexts: { device: { brand: string }; os: { name: string; version: string }; app: { app_version: string } };
  exception: { values: { type: string; value: string; mechanism: { type: string; handled: boolean }; stacktrace: { frames: ScrubbedFrame[] } }[] };
}

function newEventId(random: () => number): string {
  let id = "";
  for (let i = 0; i < 32; i++) id += Math.floor(random() * 16).toString(16);
  return id;
}

/** Builds the only shape that ever leaves the device. Pure. */
export function buildCrashEvent(
  error: unknown,
  source: CaptureSource,
  fatal: boolean,
  ctx: CrashContext,
  nowMs: number,
  random: () => number = Math.random,
): CrashEvent {
  const e = error instanceof Error ? error : null;
  // Sentry lists frames oldest first.
  const frames = scrubStack(e?.stack).reverse();
  const short = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[^\w .-]/g, "").slice(0, n) : "");
  return {
    event_id: newEventId(random),
    timestamp: nowMs / 1000,
    platform: "javascript",
    level: fatal ? "fatal" : "error",
    environment: short(ctx.environment, 20) || "production",
    release: `tarragon-mobile@${short(ctx.appVersion, 20)}`,
    dist: short(ctx.runtimeVersion, 40),
    sdk: { name: "tarragon.mobile.js-reporter", version: "1" },
    tags: {
      source,
      platform: short(ctx.platform, 12),
      runtime_version: short(ctx.runtimeVersion, 40),
      install_id: short(ctx.installId, 40),
    },
    contexts: {
      device: { brand: short(ctx.deviceBrand, 30) },
      os: { name: short(ctx.platform, 12), version: short(ctx.osVersion, 20) },
      app: { app_version: short(ctx.appVersion, 20) },
    },
    exception: {
      values: [
        {
          type: scrubErrorType(e?.name),
          value: scrubMessage(error),
          mechanism: { type: source, handled: !fatal },
          stacktrace: { frames },
        },
      ],
    },
  };
}

const NOOP: CrashReporter = { enabled: false, capture: () => {} };

export function createCrashReporter(opts: CrashReporterOptions): CrashReporter {
  const parsed = parseDsn(opts.dsn);
  if (!parsed) return NOOP;
  const fetchImpl = opts.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!fetchImpl) return NOOP;
  const now = opts.now ?? (() => Date.now());
  const maxEvents = opts.maxEvents ?? 10;
  const minGapMs = opts.minGapMs ?? 5_000;
  const timeoutMs = opts.timeoutMs ?? 3_000;
  const seen = new Set<string>();
  let sent = 0;
  let lastSendAt = -Infinity;

  return {
    enabled: true,
    capture(error, source, fatal = false) {
      try {
        const t = now();
        const event = buildCrashEvent(error, source, fatal, opts.context, t);
        const ex = event.exception.values[0];
        const top = ex.stacktrace.frames[ex.stacktrace.frames.length - 1];
        const fingerprint = `${ex.type}|${ex.value}|${top ? `${top.filename}:${top.lineno}` : ""}`;
        // A fatal is never dropped for the gap (the process is about to die) but is still de-duplicated and capped.
        if (seen.has(fingerprint)) return;
        if (sent >= maxEvents) return;
        if (!fatal && t - lastSendAt < minGapMs) return;
        seen.add(fingerprint);
        sent += 1;
        lastSendAt = t;
        const body =
          JSON.stringify({ event_id: event.event_id, sent_at: new Date(t).toISOString(), dsn: parsed.dsn }) + "\n" +
          JSON.stringify({ type: "event" }) + "\n" +
          JSON.stringify(event);
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
        Promise.resolve()
          .then(() =>
            fetchImpl(`${parsed.endpoint}?sentry_key=${parsed.publicKey}&sentry_version=7`, {
              method: "POST",
              headers: { "content-type": "application/x-sentry-envelope" },
              body,
              signal: controller?.signal,
            }),
          )
          .catch(() => {})
          .finally(() => {
            if (timer) clearTimeout(timer);
          });
      } catch {
        // A reporter that fails must be invisible.
      }
    },
  };
}
