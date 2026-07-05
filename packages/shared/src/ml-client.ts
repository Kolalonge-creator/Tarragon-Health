/**
 * Typed client for the stateless Python ML microservice (`services/ml`).
 *
 * Contract (CLAUDE.md / docs/ARCHITECTURE.md §4, §9):
 * - Talks to the ML service over HTTP only, base `ML_SERVICE_URL`, auth header
 *   `X-Service-Key` (`ML_SERVICE_KEY`).
 * - **5-second timeout, graceful fallback.** This client MUST NEVER throw — it
 *   returns `null` on any error, non-2xx, timeout, or malformed JSON. Every
 *   caller must have a non-ML fallback path (e.g. a rule-based score).
 * - The ML service is stateless; nothing here persists patient data.
 */

export const ML_DEFAULT_TIMEOUT_MS = 5_000;

export interface MlClientConfig {
  /** Base URL of the ML service, e.g. https://ml.tarragon.internal */
  baseUrl: string;
  /** Shared secret sent as the `X-Service-Key` header. */
  serviceKey: string;
  /** Per-request timeout in ms. Defaults to 5000. */
  timeoutMs?: number;
  /** Injectable fetch (defaults to global fetch) — used in tests. */
  fetchImpl?: typeof fetch;
}

/** Response of `GET /health` (Sprint 1). */
export interface MlHealth {
  status: string;
  service: string;
  version: string;
  environment: string;
}

export interface MlClient {
  /** Liveness check. Returns the health payload, or `null` if unreachable. */
  health(): Promise<MlHealth | null>;
  /**
   * POST an arbitrary typed request to an ML endpoint (e.g. `/risk/cvd`).
   * Returns the parsed response, or `null` on any failure.
   */
  post<TResponse, TRequest = unknown>(
    path: string,
    body: TRequest,
  ): Promise<TResponse | null>;
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

/**
 * Perform a request that never throws. Any network error, timeout, non-2xx
 * status, or JSON parse failure resolves to `null`.
 */
async function safeRequest<TResponse>(
  config: MlClientConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<TResponse | null> {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? ML_DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      "X-Service-Key": config.serviceKey,
      Accept: "application/json",
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetchImpl(joinUrl(config.baseUrl, path), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as TResponse;
  } catch {
    // Timeout (AbortError), network failure, or malformed JSON — degrade to null.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Create an ML client bound to a config. */
export function createMlClient(config: MlClientConfig): MlClient {
  return {
    health() {
      return safeRequest<MlHealth>(config, "GET", "/health");
    },
    post<TResponse, TRequest = unknown>(path: string, body: TRequest) {
      return safeRequest<TResponse>(config, "POST", path, body);
    },
  };
}

/**
 * Build an ML client from server-side environment variables.
 * Returns `null` if `ML_SERVICE_URL` or `ML_SERVICE_KEY` are missing, so
 * callers stay on their fallback path rather than crashing at boot.
 */
export function createMlClientFromEnv(
  env: Record<string, string | undefined> = process.env,
): MlClient | null {
  const baseUrl = env.ML_SERVICE_URL;
  const serviceKey = env.ML_SERVICE_KEY;
  if (!baseUrl || !serviceKey) {
    return null;
  }
  return createMlClient({ baseUrl, serviceKey });
}
