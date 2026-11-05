import { z } from "zod";

/**
 * Typed client for the upload scanner (`services/scanner`, decision T2-08: self-hosted ClamAV on Tarragon's own Railway account).
 *
 * Contract, same shape as ml-client.ts:
 * - HTTP only, base `SCANNER_SERVICE_URL`, auth header `X-Service-Key` (`SCANNER_SERVICE_KEY`).
 * - The body is the file's raw bytes (`application/octet-stream`); the scanner keeps nothing and writes nothing to disk.
 * - **Never throws.** Returns `null` on any network error, timeout, non-2xx status (including the scanner's own 503 when clamd is
 *   down) or malformed response. `null` means "unknown", never "clean": callers must hold the file (pending_scan), not accept it.
 * - A 200 with `status: "error"` (clamd answered but could not scan) is returned as-is; callers treat it like `null`.
 */

/** A 10 MB file uploads and scans in a few seconds; the default leaves room for a slow mobile-originated request. */
export const SCANNER_DEFAULT_TIMEOUT_MS = 20_000;

/** The lab-result buckets cap a file at 10 MB, and so does the scanner. */
export const SCANNER_MAX_BYTES = 10 * 1024 * 1024;

const scanResponseSchema = z.object({
  status: z.enum(["clean", "infected", "error"]),
  signature: z.string().nullable(),
  engine_version: z.string().nullable(),
  db_version: z.string().nullable(),
  db_date: z.string().nullable().optional(),
  size_bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  detail: z.string().nullable().optional(),
});

export type ScanResponse = z.infer<typeof scanResponseSchema>;

const healthSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("scanner"),
  version: z.string(),
  environment: z.string(),
  clamd: z.enum(["up", "down"]),
  engine_version: z.string().nullable().optional(),
  db_version: z.string().nullable().optional(),
  db_date: z.string().nullable().optional(),
});

export type ScannerHealth = z.infer<typeof healthSchema>;

export interface ScannerClientConfig {
  baseUrl: string;
  serviceKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ScannerClient {
  /** Scan the bytes. `null` when the scanner could not be reached or answered badly. */
  scan(bytes: Uint8Array | ArrayBuffer | Blob): Promise<ScanResponse | null>;
  /** Liveness and signature versions, or `null`. */
  health(): Promise<ScannerHealth | null>;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

async function toBody(bytes: Uint8Array | ArrayBuffer | Blob): Promise<ArrayBuffer> {
  if (bytes instanceof ArrayBuffer) return bytes;
  if (bytes instanceof Uint8Array) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
  return bytes.arrayBuffer();
}

async function safeRequest<T>(
  config: ScannerClientConfig,
  schema: z.ZodType<T>,
  method: "GET" | "POST",
  path: string,
  body?: ArrayBuffer,
): Promise<T | null> {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? SCANNER_DEFAULT_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { "X-Service-Key": config.serviceKey, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/octet-stream";
    const response = await fetchImpl(joinUrl(config.baseUrl, path), { method, headers, body, signal: controller.signal });
    if (!response.ok) return null;
    const parsed = schema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function createScannerClient(config: ScannerClientConfig): ScannerClient {
  return {
    async scan(bytes) {
      try {
        const body = await toBody(bytes);
        if (body.byteLength === 0 || body.byteLength > SCANNER_MAX_BYTES) return null;
        return await safeRequest(config, scanResponseSchema, "POST", "/scan", body);
      } catch {
        return null;
      }
    },
    health() {
      return safeRequest(config, healthSchema, "GET", "/health");
    },
  };
}

/**
 * The client for this environment, or `null` when `SCANNER_SERVICE_URL` is not set (the scan is switched off: uploads are stored
 * as `unscanned`, exactly as before T2-08). A URL without a key is treated as unset rather than sending unauthenticated requests.
 */
export function createScannerClientFromEnv(env: Record<string, string | undefined> = process.env): ScannerClient | null {
  const baseUrl = env.SCANNER_SERVICE_URL?.trim();
  const serviceKey = env.SCANNER_SERVICE_KEY?.trim();
  if (!baseUrl || !serviceKey) return null;
  const timeout = Number(env.SCANNER_TIMEOUT_MS);
  return createScannerClient({
    baseUrl,
    serviceKey,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : SCANNER_DEFAULT_TIMEOUT_MS,
  });
}
