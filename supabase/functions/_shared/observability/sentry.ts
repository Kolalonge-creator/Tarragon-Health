// SR1: error reporting for Supabase edge functions (Deno). Opt-in exactly like apps/web: with no SENTRY_DSN secret set,
// nothing is sent and nothing changes. No SDK: one fetch to Sentry's envelope endpoint, so the function bundle does not
// grow and a failing Sentry can never take a function down (every path here swallows its own errors, 2 second timeout).
//
// PII policy (S88 review fixes):
//   * Every string goes through scrubString before it leaves: emails, phones, OTP-like 4-8 digit runs, UUIDs, JWTs and
//     bearer tokens, URLs (scheme and host only), query strings and PostgREST filters, Postgres "Key (col)=(value)" detail,
//     JSON snippets from parse errors, and double-quoted strings.
//   * For the HIGH_RISK functions (SMS auth hook, scribe, checkout, payouts) the message is NEVER sent: only the error
//     class and a short hash of the scrubbed message, and `extra` is reduced to phase and status. A pattern scrubber cannot
//     promise to catch every name or code, and these functions handle OTPs, clinical notes and payment details.
//   * Request bodies, headers and the user are never attached. Webhook payloads and patient identifiers must not be passed
//     in `extra` by callers.
//   * Stack frames are parsed to function, file base name and line:column; unparsable lines are dropped (a multi-line
//     message cannot leak through the stack).
//
// Delivery: capture is fire and forget from withSentry (EdgeRuntime.waitUntil when the platform has it, otherwise an
// un-awaited promise with a catch), so a slow or down Sentry never adds latency to a function response, the SMS hook
// included. Each function sends at most one event per fingerprint per minute.
//
// Secrets to set (Supabase dashboard > Edge Functions > Secrets, or `supabase secrets set`):
//   SENTRY_DSN          the same DSN as the web app (a DSN is not a secret)
//   SENTRY_ENVIRONMENT  optional, default "production"
//   SENTRY_RELEASE      optional, e.g. the git sha of the deploy; default "unreleased"

/** Functions that handle OTPs, clinical text or payment data: the message text is never forwarded. */
export const HIGH_RISK_FUNCTIONS: ReadonlySet<string> = new Set(["auth-send-sms-hook", "scribe-draft", "order-checkout", "payouts"]);

const SCRUB_RULES: [RegExp, string][] = [
  // Tokens first, so one is never half-eaten by a later rule.
  [/\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*/g, "[redacted-token]"],
  [/\b(?:bearer|basic)\s+[\w.~+/=-]{8,}/gi, "[redacted-token]"],
  [/\b(?:sk|pk|rk|whsec|sbp|sb_secret|sb_publishable)_[\w-]{8,}/gi, "[redacted-token]"],
  [/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted-token]"],
  // JSON snippets (parse errors echo the body). Innermost first, repeated for nesting.
  [/\{[^{}]*\}/g, "{[redacted-json]}"],
  [/\{[^{}]*\}/g, "{[redacted-json]}"],
  [/\{[^{}]*\}/g, "{[redacted-json]}"],
  [/\[[^[\]]*"[^[\]]*\]/g, "[[redacted-json]]"],
  // Postgres detail: Key (col)=(value) already exists; Failing row contains (a, b, c).
  [/\(([\w ,"]+)\)=\([^)]*\)/g, "($1)=([redacted])"],
  [/(contains\s+)\([^)]*\)/gi, "$1([redacted])"],
  [/"[^"]*"/g, '"[redacted]"'],
  // PostgREST filters and query-string pairs.
  [/\b(?:eq|neq|gt|gte|lt|lte|like|ilike|is|cs|cd|fts|in)\.(?:\([^)]*\)|[^\s&,)]+)/gi, "[redacted-filter]"],
  [/[?&][\w.[\]%-]+=[^\s&]*/g, ""],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[redacted-email]"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[redacted-id]"],
  [/\+?\d[\d\s-]{8,14}\d/g, "[redacted-phone]"],
  // OTP-like codes and short ids. HTTP statuses are three digits and are left alone.
  [/\b\d{4,8}\b/g, "[redacted-number]"],
];

/** Every URL is reduced to scheme and host: no userinfo, path, query or fragment. */
export function stripUrls(value: string): string {
  return value.replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^\s/?#"'<>]*)[^\s"'<>]*/gi, (_m, scheme: string, authority: string) => {
    const host = authority.includes("@") ? authority.slice(authority.lastIndexOf("@") + 1) : authority;
    return `${scheme}${host}`;
  });
}

export function scrubString(value: string): string {
  let out = stripUrls(value);
  for (const [re, sub] of SCRUB_RULES) out = out.replace(re, sub);
  return out;
}

/** FNV-1a, 32 bit: groups a withheld message without carrying any of its text. */
export function shortHash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function scrubDeep(value: unknown, depth = 0): unknown {
  if (depth > 5 || value == null) return value;
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrubDeep(v, depth + 1);
    return out;
  }
  return value;
}

export interface Frame {
  filename: string;
  function: string;
  lineno?: number;
  colno?: number;
}

/** Parses "at fn (file:///x/y.ts:12:3)" / "at file:///x/y.ts:12:3" lines into function, file base name and position. */
export function parseFrames(stack: string): Frame[] {
  const frames: Frame[] = [];
  for (const raw of stack.split("\n").slice(0, 60)) {
    const m = /^at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/.exec(raw.trim().slice(0, 400));
    if (!m) continue;
    const fn = (m[1] ?? "?").replace(/[^\w$.<> ]/g, "").slice(0, 80) || "?";
    const base = (m[2]!.split(/[\\/]/).pop() ?? "").split("?")[0]!.replace(/[^\w.$-]/g, "").slice(0, 80) || "?";
    frames.push({ function: fn, filename: base, lineno: Number(m[3]), colno: Number(m[4]) });
    if (frames.length >= 10) break;
  }
  return frames;
}

export interface ParsedDsn {
  endpoint: string;
  publicKey: string;
  dsn: string;
}

/** "https://KEY@o123.ingest.sentry.io/456" to the envelope endpoint. Returns null for anything malformed. */
export function parseDsn(dsn: string | undefined | null): ParsedDsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, "");
    if (!u.username || !projectId || !/^[0-9]+$/.test(projectId)) return null;
    return { endpoint: `${u.protocol}//${u.host}/api/${projectId}/envelope/`, publicKey: u.username, dsn };
  } catch {
    return null;
  }
}

export interface EdgeEvent {
  event_id: string;
  timestamp: number;
  platform: "javascript";
  level: "error";
  environment: string;
  release: string;
  server_name: string;
  tags: Record<string, string>;
  extra: Record<string, unknown>;
  exception: { values: { type: string; value: string; stacktrace?: { frames: Frame[] } }[] };
}

function eventId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function buildEvent(
  functionName: string,
  err: unknown,
  extra: Record<string, unknown> = {},
  env: { environment?: string; release?: string } = {},
): EdgeEvent {
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : "non-Error thrown");
  const highRisk = HIGH_RISK_FUNCTIONS.has(functionName);
  const name = /^[A-Za-z_$][\w$]{0,60}$/.test(e.name) ? e.name : "Error";
  const scrubbed = scrubString(e.message);
  const value = highRisk ? `message withheld (ref ${shortHash(scrubbed)})` : scrubbed;
  const safeExtra: Record<string, unknown> = highRisk
    ? Object.fromEntries(
        Object.entries(extra).filter(([k, v]) => (k === "phase" && typeof v === "string") || (k === "status" && typeof v === "number")),
      )
    : (scrubDeep(extra) as Record<string, unknown>);
  return {
    event_id: eventId(),
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: "error",
    environment: env.environment ?? "production",
    release: env.release ?? "unreleased",
    server_name: functionName,
    tags: { edge_function: functionName, runtime: "supabase-edge" },
    extra: safeExtra,
    exception: { values: [{ type: name, value, stacktrace: { frames: parseFrames(e.stack ?? "") } }] },
  };
}

const DEDUPE_WINDOW_MS = 60_000;
const DEDUPE_MAX_KEYS = 200;
const lastSentAt = new Map<string, number>();

/** One event per fingerprint per minute, per isolate. Returns true when this one may go out. */
function allowSend(key: string, nowMs: number): boolean {
  const prev = lastSentAt.get(key);
  if (prev !== undefined && nowMs - prev < DEDUPE_WINDOW_MS) return false;
  if (lastSentAt.size >= DEDUPE_MAX_KEYS) {
    for (const [k, t] of lastSentAt) if (nowMs - t >= DEDUPE_WINDOW_MS) lastSentAt.delete(k);
    if (lastSentAt.size >= DEDUPE_MAX_KEYS) lastSentAt.clear();
  }
  lastSentAt.set(key, nowMs);
  return true;
}

/** Test hook: forget the per-fingerprint rate limit. */
export function resetSentryRateLimit(): void {
  lastSentAt.clear();
}

/** Sends one event. Resolves true when Sentry accepted it, false for anything else. Never throws. */
export async function captureEdgeError(
  functionName: string,
  err: unknown,
  extra: Record<string, unknown> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const parsed = parseDsn(Deno.env.get("SENTRY_DSN"));
    if (!parsed) return false;
    const event = buildEvent(functionName, err, extra, {
      environment: Deno.env.get("SENTRY_ENVIRONMENT") ?? undefined,
      release: Deno.env.get("SENTRY_RELEASE") ?? undefined,
    });
    const ex = event.exception.values[0]!;
    if (!allowSend(`${functionName}|${ex.type}|${ex.value}`, Date.now())) return false;
    const body =
      JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString(), dsn: parsed.dsn }) + "\n" +
      JSON.stringify({ type: "event" }) + "\n" +
      JSON.stringify(event);
    const res = await fetchImpl(`${parsed.endpoint}?sentry_key=${parsed.publicKey}&sentry_version=7`, {
      method: "POST",
      headers: { "content-type": "application/x-sentry-envelope" },
      body,
      signal: AbortSignal.timeout(2000),
    });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

type EdgeRuntimeLike = { waitUntil?: (p: Promise<unknown>) => void };

/**
 * Hands a capture to the platform without making the response wait for it. With EdgeRuntime.waitUntil the isolate is kept
 * alive until the send finishes (so a thrown handler still reports); without it the promise is simply not awaited.
 */
function fireAndForget(p: Promise<unknown>): void {
  const safe = p.catch(() => false);
  try {
    const rt = (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
    if (rt && typeof rt.waitUntil === "function") rt.waitUntil(safe);
  } catch {
    // never
  }
}

/**
 * Wraps a Deno.serve handler: an uncaught throw is reported, then re-thrown unchanged so the platform's own behaviour
 * (a 500, logs) is exactly what it was before. A handler that RETURNS a 5xx is also reported, with the status only.
 * Reporting is never awaited: response time does not depend on Sentry.
 */
export function withSentry<A extends unknown[]>(
  functionName: string,
  handler: (req: Request, ...rest: A) => Response | Promise<Response>,
  fetchImpl: typeof fetch = fetch,
): (req: Request, ...rest: A) => Promise<Response> {
  return async (req, ...rest) => {
    let res: Response;
    try {
      res = await handler(req, ...rest);
    } catch (err) {
      fireAndForget(captureEdgeError(functionName, err, { phase: "uncaught" }, fetchImpl));
      throw err;
    }
    if (res.status >= 500) {
      fireAndForget(captureEdgeError(functionName, new Error(`edge function returned HTTP ${res.status}`), { phase: "5xx", status: res.status }, fetchImpl));
    }
    return res;
  };
}
