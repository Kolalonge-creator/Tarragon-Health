import "server-only";
import { randomUUID, createHash } from "crypto";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { hasScope, verifyApiKey, type ApiKeyScope, type VerifiedApiKey } from "./api-key";
import { rateLimit } from "@/lib/rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database, Json } from "@tarragon/shared";

/**
 * The API gateway pipeline (spec §33.2): every partner-facing route under
 * /api/v1 runs through ONE function instead of hand-rolling its own
 * auth -> scope -> validate -> rate-limit -> log sequence. Before this, each
 * of the six existing partner routes
 * (device-readings/me, protocol-api/v1/{me,bp-triage,diabetes-risk,cv-risk})
 * reimplemented the same four steps inline and recorded nothing beyond
 * api_keys.last_used_at (or, for Protocol API, one extra row in
 * protocol_api_usage_log) — nothing answered §33.9's own question list
 * (uptime, latency, failed requests, authentication failures). Every stage
 * below writes exactly one outcome to public.api_requests, on every path,
 * including the ones that fail before a handler ever runs — that log is the
 * whole point of centralising this.
 *
 * THIS DOES NOT REPLACE THE SIX EXISTING ROUTES. They stay exactly as they
 * are — CLAUDE.md's own "no dual source of truth" principle cuts the other
 * way here too: a route with real partners already depending on its exact
 * response shape does not get rewritten just to sit on shared plumbing.
 * runGateway is for /api/v1/* (part 5) and any future partner endpoint.
 *
 * PIPELINE ORDER (mirrors §33.2's own diagram exactly):
 *   Authentication (verifyApiKey) -> Authorisation (scope)
 *   -> Idempotency replay check -> Validation (zod) -> Rate limiting
 *   -> the handler -> Idempotency store -> api_requests log row.
 * Idempotency is deliberately checked BEFORE validation: a partner retrying
 * an already-processed call should get the original response even if, say,
 * a schema tightened between the two attempts — the replay is a cache hit,
 * not a fresh request.
 */

export interface GatewayContext {
  verified: VerifiedApiKey;
  supabase: ReturnType<typeof createServiceRoleClient>;
  requestId: string;
  /** The raw request, for a GET/HEAD handler to read its own query
   * parameters — those methods carry no body, so `schema` validates an
   * empty object for them and this is how the handler gets its real input. */
  request: Request;
}

export interface GatewayResult {
  status: number;
  body: Record<string, unknown>;
}

export interface GatewayOptions<TBody> {
  /** e.g. "v1". Recorded on every request row (§33.4). */
  version: string;
  /** ROUTE TEMPLATE only, e.g. "/api/v1/observations" — never a resolved URL
   * with path params filled in. See api_requests' own CHECK constraint. */
  endpoint: string;
  /** Omit for a scope-free endpoint (e.g. a key self-test) that any valid,
   * unrevoked, unexpired key may call regardless of what scopes it holds. */
  scope?: ApiKeyScope;
  schema: z.ZodType<TBody>;
  handle: (body: TBody, ctx: GatewayContext) => Promise<GatewayResult>;
}

const REQUEST_ID_HEADER = "X-Request-Id";
/** The presented credential's own prefix, read directly off the header
 * without verifying it — the only non-secret fragment of an unrecognised
 * key we can still attribute an auth-failure row to (§33.9). */
const PRESENTED_KEY_PATTERN = /^th_(?:live|test)_[0-9a-f]+$/;

function errorResult(status: number, error: string): GatewayResult {
  return { status, body: { error } };
}

function outcomeForStatus(
  status: number,
  explicit?: Database["public"]["Enums"]["api_request_outcome"]
): Database["public"]["Enums"]["api_request_outcome"] {
  if (explicit) return explicit;
  if (status >= 200 && status < 300) return "ok";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "unprocessable";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "bad_request";
}

/** SHA-256 of the canonicalised (parsed-and-reserialised) body — two
 * semantically-identical requests with different key ordering or
 * whitespace fingerprint the same, so a partner's retry is recognised even
 * if their HTTP client re-serialises the JSON slightly differently. */
function fingerprint(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

function presentedKeyPrefix(request: Request): string | null {
  const raw =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("x-api-key");
  if (!raw || !PRESENTED_KEY_PATTERN.test(raw)) return null;
  return raw.slice(0, 16);
}

interface AuthorisedRunOutcome {
  result: GatewayResult;
  idempotentReplay: boolean;
}

async function runAuthorised<TBody>(
  request: Request,
  opts: GatewayOptions<TBody>,
  verified: VerifiedApiKey,
  supabase: ReturnType<typeof createServiceRoleClient>,
  idempotencyKey: string | null,
  requestId: string
): Promise<AuthorisedRunOutcome> {
  // GET/HEAD carry no body — those handlers read their input from the
  // request's own query string via ctx.request instead, so `schema` just
  // validates an empty object for them.
  const isBodyless = request.method === "GET" || request.method === "HEAD";
  let rawBody: unknown = {};
  if (!isBodyless) {
    try {
      rawBody = await request.json();
    } catch {
      return { result: errorResult(400, "Invalid JSON body"), idempotentReplay: false };
    }
  }

  // §33.12 idempotency, checked before validation — see module header.
  // Never applied to a bodyless read: an Idempotency-Key on a GET would
  // otherwise pin a moment-in-time answer behind a 24h cache, which is not
  // what that header means for a read endpoint.
  if (idempotencyKey && !isBodyless) {
    const requestFingerprint = fingerprint(rawBody);
    const { data: existing } = await supabase
      .from("api_idempotency_records")
      .select("request_fingerprint, response_status, response_body")
      .eq("api_key_id", verified.keyId)
      .eq("endpoint", opts.endpoint)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existing) {
      if (existing.request_fingerprint !== requestFingerprint) {
        return {
          result: errorResult(409, "Idempotency-Key was already used with a different request body"),
          idempotentReplay: false,
        };
      }
      return {
        result: { status: existing.response_status, body: existing.response_body as Record<string, unknown> },
        idempotentReplay: true,
      };
    }
  }

  const parsed = opts.schema.safeParse(rawBody);
  if (!parsed.success) {
    return { result: errorResult(400, parsed.error.issues[0]?.message ?? "Invalid input"), idempotentReplay: false };
  }

  const rl = await rateLimit(`gateway:${verified.keyId}`, { limit: verified.rateLimitPerMinute, windowSeconds: 60 });
  if (!rl.success) {
    return {
      result: errorResult(429, `Rate limit exceeded — retry after ${rl.retryAfterSeconds}s`),
      idempotentReplay: false,
    };
  }

  const handled = await opts.handle(parsed.data, { verified, supabase, requestId, request });

  if (idempotencyKey && !isBodyless && handled.status < 500) {
    // Best-effort store: a race where two retries land at once is fine —
    // one wins the unique index, the other's insert no-ops harmlessly, and
    // both already have the correct response to return to their caller.
    await supabase
      .from("api_idempotency_records")
      .insert({
        organisation_id: verified.organisationId,
        api_key_id: verified.keyId,
        endpoint: opts.endpoint,
        idempotency_key: idempotencyKey,
        request_fingerprint: fingerprint(rawBody),
        response_status: handled.status,
        response_body: handled.body as Json,
      })
      .then(
        () => undefined,
        () => undefined
      );
  }

  return { result: handled, idempotentReplay: false };
}

export async function runGateway<TBody>(request: Request, opts: GatewayOptions<TBody>): Promise<NextResponse> {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const supabase = createServiceRoleClient();
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() || null;
  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  let verified: VerifiedApiKey | null = null;
  let explicitOutcome: Database["public"]["Enums"]["api_request_outcome"] | undefined;
  let idempotentReplay = false;
  let result: GatewayResult;

  try {
    verified = await verifyApiKey(request);
    if (!verified) {
      explicitOutcome = "unauthenticated";
      result = errorResult(401, "Invalid, revoked, or expired API key");
    } else if (opts.scope && !hasScope(verified, opts.scope)) {
      explicitOutcome = "forbidden";
      result = errorResult(403, `API key lacks the ${opts.scope} scope`);
    } else {
      const outcome = await runAuthorised(request, opts, verified, supabase, idempotencyKey, requestId);
      result = outcome.result;
      idempotentReplay = outcome.idempotentReplay;
      if (result.status === 409) explicitOutcome = "conflict";
    }
  } catch (error) {
    explicitOutcome = "server_error";
    result = errorResult(500, error instanceof Error ? error.message : "Internal error");
  }

  await logRequest(supabase, {
    organisationId: verified?.organisationId ?? null,
    apiKeyId: verified?.keyId ?? null,
    keyPrefix: verified ? null : presentedKeyPrefix(request),
    environment: verified?.environment ?? "live",
    version: opts.version,
    method: request.method,
    endpoint: opts.endpoint,
    status: result.status,
    outcome: outcomeForStatus(result.status, explicitOutcome),
    durationMs: Date.now() - startedAt,
    requestId,
    idempotencyKey,
    idempotentReplay,
    errorCode:
      result.status >= 400 ? (typeof result.body.error === "string" ? result.body.error.slice(0, 64) : "error") : null,
    clientIp,
  });

  return NextResponse.json(result.body, { status: result.status, headers: { [REQUEST_ID_HEADER]: requestId } });
}

interface LogRequestInput {
  organisationId: string | null;
  apiKeyId: string | null;
  keyPrefix: string | null;
  environment: Database["public"]["Enums"]["api_environment"];
  version: string;
  method: string;
  endpoint: string;
  status: number;
  outcome: Database["public"]["Enums"]["api_request_outcome"];
  durationMs: number;
  requestId: string;
  idempotencyKey: string | null;
  idempotentReplay: boolean;
  errorCode: string | null;
  clientIp: string | null;
}

/** Never lets a logging failure turn a working partner call into an error
 * — same discipline as api_keys.last_used_at and protocol_api_usage_log
 * elsewhere in this codebase. Awaited (not fire-and-forget) so the row
 * exists before the function returns in a serverless environment that may
 * freeze the process right after the response is sent. */
async function logRequest(supabase: ReturnType<typeof createServiceRoleClient>, input: LogRequestInput): Promise<void> {
  try {
    await supabase.from("api_requests").insert({
      organisation_id: input.organisationId,
      api_key_id: input.apiKeyId,
      key_prefix: input.keyPrefix,
      environment: input.environment,
      api_version: input.version,
      method: input.method,
      endpoint: input.endpoint,
      outcome: input.outcome,
      status_code: input.status,
      duration_ms: input.durationMs,
      request_id: input.requestId,
      idempotency_key: input.idempotencyKey,
      idempotent_replay: input.idempotentReplay,
      error_code: input.errorCode,
      client_ip: input.clientIp,
    });
  } catch {
    // best-effort — see doc comment
  }
}
