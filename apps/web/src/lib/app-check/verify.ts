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

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

export function resetJwksCacheForTests(): void {
  jwksCache = null;
}

async function loadJwks(fetchImpl: typeof fetch, now: number): Promise<Jwk[]> {
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetchImpl(JWKS_URL, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache = { keys, fetchedAt: now };
  return keys;
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
    const jwk = (await loadJwks(fetchImpl, now)).find((k) => k.kid === header.kid);
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

/**
 * The proxy's hook. Returns true when the request must be refused (enforce mode only). Logs a single line with the
 * verdict and path, never the token, never a user id.
 */
export async function appCheckShouldRefuse(
  headers: Headers,
  pathname: string,
  options: { mode?: AppCheckMode; fetchImpl?: typeof fetch; log?: (line: string) => void } = {},
): Promise<boolean> {
  const mode = options.mode ?? appCheckMode();
  if (mode === "off") return false;
  const log = options.log ?? ((line: string) => console.info(line));
  try {
    const verdict = await verifyAppCheckToken(headers.get(APP_CHECK_HEADER), { fetchImpl: options.fetchImpl });
    const detail = verdict.status === "invalid" ? ` reason=${verdict.reason}` : "";
    // Every app version before this build sends no token: a "missing" line per request in monitor mode would only be noise.
    if (!(mode === "monitor" && verdict.status === "missing")) log(`[app-check] mode=${mode} status=${verdict.status}${detail} path=${pathname}`);
    return mode === "enforce" && verdict.status !== "valid";
  } catch {
    // Fails open: a broken check must never take the mobile API down.
    return false;
  }
}
