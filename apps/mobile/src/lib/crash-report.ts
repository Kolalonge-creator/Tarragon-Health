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
 *  - never writes to disk: there is no retry queue. A report that fails to send is dropped. (A fatal is the one case that
 *    waits, briefly: `handleGlobalError` holds the previous handler for a bounded grace so the send can leave the radio
 *    before the OS kills the process. No file, no marker, nothing persisted.)
 *  - rate limited and de-duplicated per process, so a render loop cannot flood Sentry or the radio. Fatals have their own
 *    budget and are de-duplicated only against other fatals, so a burst of non-fatal noise can never swallow a crash.
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
  /** Non-fatal events allowed per process. Fatals have their own budget (maxFatals) and never consume this one. */
  maxEvents?: number;
  /** Fatal events allowed per process. They do not count against the non-fatal cap. */
  maxFatals?: number;
  /** Minimum gap between two sends, ms. */
  minGapMs?: number;
  timeoutMs?: number;
}

export type CaptureSource = "global_handler" | "promise_rejection" | "error_boundary" | "manual";

export interface CrashReporter {
  readonly enabled: boolean;
  capture(error: unknown, source: CaptureSource, fatal?: boolean): void;
  /**
   * Same as `capture`, but the send starts synchronously and the returned promise settles when the request has finished,
   * failed or timed out. It never rejects. Used for fatals so the caller can wait a bounded time before the process dies.
   */
  captureAndFlush(error: unknown, source: CaptureSource, fatal?: boolean): Promise<void>;
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

const NOOP: CrashReporter = { enabled: false, capture: () => {}, captureAndFlush: () => Promise.resolve() };

export function createCrashReporter(opts: CrashReporterOptions): CrashReporter {
  const parsed = parseDsn(opts.dsn);
  if (!parsed) return NOOP;
  const fetchImpl = opts.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!fetchImpl) return NOOP;
  const now = opts.now ?? (() => Date.now());
  const maxEvents = opts.maxEvents ?? 10;
  const maxFatals = opts.maxFatals ?? 5;
  const minGapMs = opts.minGapMs ?? 5_000;
  const timeoutMs = opts.timeoutMs ?? 3_000;
  const seen = new Set<string>();
  let sent = 0;
  let sentFatal = 0;
  let lastSendAt = -Infinity;

  /** Starts the send synchronously (when the event is accepted) and returns a promise that settles, never rejects. */
  function send(error: unknown, source: CaptureSource, fatal: boolean): Promise<void> {
    try {
      const t = now();
      const event = buildCrashEvent(error, source, fatal, opts.context, t);
      const ex = event.exception.values[0]!;
      const top = ex.stacktrace.frames[ex.stacktrace.frames.length - 1];
      // The level is part of the fingerprint: a fatal is never dropped because a non-fatal looked the same.
      const fingerprint = `${event.level}|${ex.type}|${ex.value}|${top ? `${top.filename}:${top.lineno}` : ""}`;
      if (seen.has(fingerprint)) return Promise.resolve();
      if (fatal) {
        // Fatals bypass the non-fatal cap and the gap; they have a small budget of their own.
        if (sentFatal >= maxFatals) return Promise.resolve();
        sentFatal += 1;
      } else {
        if (sent >= maxEvents) return Promise.resolve();
        if (t - lastSendAt < minGapMs) return Promise.resolve();
        sent += 1;
        lastSendAt = t;
      }
      seen.add(fingerprint);
      const body =
        JSON.stringify({ event_id: event.event_id, sent_at: new Date(t).toISOString(), dsn: parsed.dsn }) + "\n" +
        JSON.stringify({ type: "event" }) + "\n" +
        JSON.stringify(event);
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      let request: Promise<unknown>;
      try {
        // Called synchronously: for a fatal there is no time for a deferred microtask to matter, but it must start now.
        request = Promise.resolve(
          fetchImpl(`${parsed.endpoint}?sentry_key=${parsed.publicKey}&sentry_version=7`, {
            method: "POST",
            headers: { "content-type": "application/x-sentry-envelope" },
            body,
            signal: controller?.signal,
          }),
        );
      } catch {
        request = Promise.resolve();
      }
      return request
        .then(
          () => undefined,
          () => undefined,
        )
        .then(() => {
          if (timer) clearTimeout(timer);
        });
    } catch {
      // A reporter that fails must be invisible.
      return Promise.resolve();
    }
  }

  return {
    enabled: true,
    capture(error, source, fatal = false) {
      void send(error, source, fatal);
    },
    captureAndFlush(error, source, fatal = false) {
      return send(error, source, fatal);
    },
  };
}

export interface GlobalErrorOptions {
  /** Longest the previous handler is held back for a fatal so the report can leave the device. */
  graceMs?: number;
  setTimeoutImpl?: (fn: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (id: unknown) => void;
}

/** Default grace before a fatal error is handed to the previous handler (and so to the OS crash). */
export const FATAL_GRACE_MS = 800;

/**
 * The ErrorUtils global-handler body. A non-fatal is captured and the previous handler is called straight away. For a
 * fatal the send starts synchronously, and the previous handler is held back until the request settles or `graceMs`
 * passes, whichever is first, because the previous handler is what lets native kill the process. The previous handler is
 * always called exactly once. With a dormant reporter nothing is delayed.
 */
export function handleGlobalError(
  reporter: CrashReporter | null,
  error: unknown,
  fatal: boolean | undefined,
  previous: ((e: unknown, fatal?: boolean) => void) | undefined,
  describe: (e: unknown) => unknown,
  opts: GlobalErrorOptions = {},
): void {
  const isFatal = fatal === true;
  if (!reporter || !reporter.enabled) {
    previous?.(error, fatal);
    return;
  }
  if (!isFatal) {
    try {
      reporter.capture(describe(error), "global_handler", false);
    } catch {
      // never
    }
    previous?.(error, fatal);
    return;
  }
  const setT = opts.setTimeoutImpl ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = opts.clearTimeoutImpl ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let called = false;
  let timer: unknown = null;
  const proceed = () => {
    if (called) return;
    called = true;
    if (timer !== null) clearT(timer);
    previous?.(error, fatal);
  };
  let flushed: Promise<void>;
  try {
    flushed = reporter.captureAndFlush(describe(error), "global_handler", true);
  } catch {
    flushed = Promise.resolve();
  }
  timer = setT(proceed, opts.graceMs ?? FATAL_GRACE_MS);
  void flushed.then(proceed, proceed);
}

export interface RejectionTrackerOptions {
  capture: (error: unknown) => void;
  /** React Native's own tracker (dev only: LogBox warnings). Always called so its behaviour is unchanged. */
  previous?: { onUnhandled?: (id: number, error: unknown) => void; onHandled?: (id: number) => void } | null;
  /** How long a rejection waits for a late handler before it is reported. */
  settleMs?: number;
  setTimeoutImpl?: (fn: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (id: unknown) => void;
}

/**
 * Hermes calls onUnhandled when a rejected promise has no handler yet and onHandled when one is attached later. A
 * rejection is reported only if no handler shows up within `settleMs`, so a handled rejection is not reported. The
 * previous tracker (RN installs one in development) is chained, not replaced.
 */
export function createRejectionTracker(opts: RejectionTrackerOptions): {
  allRejections: true;
  onUnhandled: (id: number, error: unknown) => void;
  onHandled: (id: number) => void;
} {
  const setT = opts.setTimeoutImpl ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = opts.clearTimeoutImpl ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const settleMs = opts.settleMs ?? 2_000;
  const pending = new Map<number, unknown>();
  return {
    allRejections: true,
    onUnhandled(id, error) {
      try {
        opts.previous?.onUnhandled?.(id, error);
      } catch {
        // never
      }
      try {
        pending.set(
          id,
          setT(() => {
            pending.delete(id);
            try {
              opts.capture(error);
            } catch {
              // never
            }
          }, settleMs),
        );
      } catch {
        // never
      }
    },
    onHandled(id) {
      try {
        opts.previous?.onHandled?.(id);
      } catch {
        // never
      }
      if (pending.has(id)) {
        clearT(pending.get(id));
        pending.delete(id);
      }
    },
  };
}
