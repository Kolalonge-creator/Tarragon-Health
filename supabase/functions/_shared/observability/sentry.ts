// SR1: error reporting for Supabase edge functions (Deno). Opt-in exactly like apps/web: with no SENTRY_DSN secret set,
// nothing is sent and nothing changes. No SDK: one fetch to Sentry's envelope endpoint, so the function bundle does not
// grow and a failing Sentry can never take a function down (every path here swallows its own errors, 2 second timeout).
//
// PII: the same scrubbing as apps/web/src/lib/sentry/scrub-pii.ts (email, phone-shaped digit runs) is applied to the
// message, the stack and every string in `extra` BEFORE the event leaves the function. Request bodies, headers and
// the user are never attached. Webhook payloads and patient identifiers must not be passed in `extra` by callers.
//
// Secrets to set (Supabase dashboard > Edge Functions > Secrets, or `supabase secrets set`):
//   SENTRY_DSN          the same DSN as the web app (a DSN is not a secret)
//   SENTRY_ENVIRONMENT  optional, default "production"
//   SENTRY_RELEASE      optional, e.g. the git sha of the deploy; default "unreleased"

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE_RE = /\+?\d[\d\s-]{8,14}\d/g;

export function scrubString(value: string): string {
  return value.replace(EMAIL_RE, "[redacted-email]").replace(PHONE_RE, "[redacted-phone]");
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
  exception: { values: { type: string; value: string; stacktrace?: { frames: { filename: string; function: string }[] } }[] };
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
  const frames = (e.stack ?? "")
    .split("\n")
    .slice(1, 11)
    .map((line) => ({ filename: scrubString(line.trim()), function: "?" }));
  return {
    event_id: eventId(),
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: "error",
    environment: env.environment ?? "production",
    release: env.release ?? "unreleased",
    server_name: functionName,
    tags: { edge_function: functionName, runtime: "supabase-edge" },
    extra: scrubDeep(extra) as Record<string, unknown>,
    exception: { values: [{ type: e.name || "Error", value: scrubString(e.message), stacktrace: { frames } }] },
  };
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

/**
 * Wraps a Deno.serve handler: an uncaught throw is reported, then re-thrown unchanged so the platform's own behaviour
 * (a 500, logs) is exactly what it was before. A handler that RETURNS a 5xx is also reported once, with the status only.
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
      await captureEdgeError(functionName, err, { phase: "uncaught" }, fetchImpl);
      throw err;
    }
    if (res.status >= 500) {
      await captureEdgeError(functionName, new Error(`edge function returned HTTP ${res.status}`), { phase: "5xx", status: res.status }, fetchImpl);
    }
    return res;
  };
}
