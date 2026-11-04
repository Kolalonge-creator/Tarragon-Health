/**
 * Firebase App Check verification for /api/mobile/* (the Android app sends `X-Firebase-AppCheck`, attested by Google
 * Play Integrity; see apps/mobile/src/lib/app-check.ts). Runs in the proxy, with Web Crypto only (no new dependency).
 *
 * MODE (APP_CHECK_MODE):
 *  - "monitor" (default): verify and log one line per request that carries a token, plus a line for requests without one;
 *    NEVER refuse. This is where it starts: no build that sends tokens has ever run on a real phone, and older app
 *    versions in the field send none.
 *  - "enforce": refuse a request with a missing or invalid token (401). Only after monitor logs show real devices
 *    passing, and never for the safety routes a delay could turn into delayed care (the caller decides which).
 *  - "off": do nothing.
 *
 * A token is valid when it is an RS256 JWT signed by a key from Firebase App Check's JWKS, issued by
 * https://firebaseappcheck.googleapis.com/<project number>, with audience projects/<project number>, unexpired.
 * The verifier fails CLOSED on its own answer (anything unexpected is "invalid") but the caller fails OPEN in monitor mode.
 */

export const APP_CHECK_HEADER = "x-firebase-appcheck";
export const FIREBASE_PROJECT_NUMBER = "17658440935";
const JWKS_URL = "https://firebaseappcheck.googleapis.com/v1/jwks";
const JWKS_TTL_MS = 6 * 60 * 60 * 1000;

export type AppCheckMode = "off" | "monitor" | "enforce";

export function appCheckMode(value: string | undefined = process.env.APP_CHECK_MODE): AppCheckMode {
  return value === "off" || value === "enforce" ? value : "monitor";
}

export type AppCheckVerdict =
  | { status: "missing" }
  | { status: "valid"; appId: string }
  | { status: "invalid"; reason: string };

interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  n?: string;
  e?: string;
}

const JWKS_FAILURE_TTL_MS = 5 * 60 * 1000;
const JWKS_REFETCH_MIN_MS = 10 * 60 * 1000;

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
/** After a failed fetch, verification answers "invalid" at once for a few minutes instead of waiting on the timeout per request. */
let jwksFailedAt: number | null = null;

export function resetJwksCacheForTests(): void {
  jwksCache = null;
  jwksFailedAt = null;
}

async function fetchJwks(fetchImpl: typeof fetch, now: number): Promise<Jwk[] | null> {
  if (jwksFailedAt !== null && now - jwksFailedAt < JWKS_FAILURE_TTL_MS) return null;
  try {
    const res = await fetchImpl(JWKS_URL, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`jwks ${res.status}`);
    const body = (await res.json()) as { keys?: Jwk[] };
    const keys = Array.isArray(body.keys) ? body.keys : [];
    jwksCache = { keys, fetchedAt: now };
    jwksFailedAt = null;
    return keys;
  } catch {
    jwksFailedAt = now;
    return null;
  }
}

/** The key for this kid. Refetches on an unknown kid (Firebase rotated its keys), at most once per JWKS_REFETCH_MIN_MS. */
async function findKey(kid: string, fetchImpl: typeof fetch, now: number): Promise<Jwk | null> {
  const fresh = jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS;
  let keys = fresh ? jwksCache!.keys : (await fetchJwks(fetchImpl, now)) ?? jwksCache?.keys ?? [];
  let key = keys.find((k) => k.kid === kid);
  if (!key && jwksCache && now - jwksCache.fetchedAt >= JWKS_REFETCH_MIN_MS) {
    keys = (await fetchJwks(fetchImpl, now)) ?? keys;
    key = keys.find((k) => k.kid === kid);
  }
  return key ?? null;
}

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const bin = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function decodeJson(segment: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function verifyAppCheckToken(
  token: string | null,
  options: { fetchImpl?: typeof fetch; nowMs?: number; projectNumber?: string } = {},
): Promise<AppCheckVerdict> {
  if (!token) return { status: "missing" };
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.nowMs ?? Date.now();
  const project = options.projectNumber ?? FIREBASE_PROJECT_NUMBER;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return { status: "invalid", reason: "malformed" };
    const header = decodeJson(parts[0]);
    const payload = decodeJson(parts[1]);
    if (!header || !payload) return { status: "invalid", reason: "malformed" };
    if (header.alg !== "RS256" || header.typ !== "JWT" || typeof header.kid !== "string") {
      return { status: "invalid", reason: "header" };
    }
    const jwk = await findKey(header.kid, fetchImpl, now);
    if (!jwk || jwk.kty !== "RSA" || !jwk.n || !jwk.e) return { status: "invalid", reason: "unknown_key" };
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlToBytes(parts[2]), signed);
    if (!ok) return { status: "invalid", reason: "signature" };

    if (payload.iss !== `https://firebaseappcheck.googleapis.com/${project}`) return { status: "invalid", reason: "issuer" };
    const aud = payload.aud;
    const audiences = Array.isArray(aud) ? aud : [aud];
    if (!audiences.includes(`projects/${project}`)) return { status: "invalid", reason: "audience" };
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= now) return { status: "invalid", reason: "expired" };
    if (typeof payload.sub !== "string" || !payload.sub) return { status: "invalid", reason: "subject" };
    return { status: "valid", appId: payload.sub };
  } catch {
    return { status: "invalid", reason: "error" };
  }
}

/** Share of "valid" and "missing" verdicts logged in monitor mode; every "invalid" one is logged. */
export const MONITOR_SAMPLE_RATE = 0.01;

/**
 * The proxy's hook. Returns true when the request must be refused (enforce mode only). Logs one line per invalid token
 * and a 1% sample of the rest (enough to measure the share of requests without a token before enforcing), never the
 * token, never a user id.
 */
export async function appCheckShouldRefuse(
  headers: Headers,
  pathname: string,
  options: { mode?: AppCheckMode; fetchImpl?: typeof fetch; log?: (line: string) => void; random?: () => number } = {},
): Promise<boolean> {
  const mode = options.mode ?? appCheckMode();
  if (mode === "off") return false;
  const log = options.log ?? ((line: string) => console.info(line));
  const random = options.random ?? Math.random;
  try {
    const verdict = await verifyAppCheckToken(headers.get(APP_CHECK_HEADER), { fetchImpl: options.fetchImpl });
    if (verdict.status === "invalid") {
      log(`[app-check] mode=${mode} status=invalid reason=${verdict.reason} path=${pathname}`);
    } else if (random() < MONITOR_SAMPLE_RATE) {
      log(`[app-check] mode=${mode} status=${verdict.status} sample=${MONITOR_SAMPLE_RATE} path=${pathname}`);
    }
    return mode === "enforce" && verdict.status !== "valid";
  } catch {
    // Fails open: a broken check must never take the mobile API down.
    return false;
  }
}
