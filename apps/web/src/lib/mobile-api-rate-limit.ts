import { NextResponse } from "next/server";

/**
 * A request-rate limit for every /api/mobile/* route, applied once in the proxy (OQ-267: of 37 mobile routes only four had any limit).
 *
 * Two buckets, both deliberately generous because the app syncs queued readings in bursts after a patient comes back online:
 *  - per SESSION (a hash of the bearer token): 240 requests a minute. This is the real limit.
 *  - per IP: 3000 a minute. A flood cap only. Many phones share one mobile-carrier address in Nigeria, so a tight per-IP limit
 *    would lock out unrelated patients; the session bucket is what stops one logged-in client hammering an endpoint.
 * The session key is a hash of the bearer TOKEN alone (scheme and spacing stripped), never a decoded user id: an unverified id
 * would let anyone spend a victim's allowance, and hashing the whole header would give one session several buckets. A forged or
 * random token only gets a fresh bucket of its own, still bound by the IP cap.
 *
 * SAFETY ROUTES ARE NOT SESSION-LIMITED. A dangerous reading, a danger-symptom check or an emergency must never wait behind a
 * bulk sync that has used up the session's allowance (a 429 is retried by the app's outbox only after a 30 s or longer backoff).
 * Those routes keep the IP flood cap only. Add a route here only if a delay in it could delay care.
 *
 * Fails open: if this code throws for any reason the request goes on to the route, which still authenticates it. The limiter
 * itself (packages/auth/src/rate-limit-core.ts) falls back to an in-process window when Upstash is unset or down. That window is
 * PER SERVER INSTANCE, so until UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set the real ceiling is the limit
 * multiplied by the number of warm instances (docs/runbooks/hosting-baseline-checklist.md section 3).
 */

export type LimitFn = (key: string, rule: { limit: number; windowSeconds: number }) => Promise<{ success: boolean; retryAfterSeconds: number }>;

export const MOBILE_SESSION_RULE = { limit: 240, windowSeconds: 60 } as const;
export const MOBILE_IP_RULE = { limit: 3000, windowSeconds: 60 } as const;

/** Routes a delay could turn into delayed care: IP flood cap only, never the session bucket. */
const SAFETY_PREFIXES = [
  "/api/mobile/vitals",
  "/api/mobile/device-readings",
  "/api/mobile/cgm-readings",
  "/api/mobile/symptom-check",
  "/api/mobile/symptom-checkback",
  "/api/mobile/symptom-describe-danger",
  "/api/mobile/community-emergency",
  "/api/mobile/emergency-card",
  "/api/mobile/health-check",
] as const;

export function isMobileApiPath(pathname: string): boolean {
  return pathname === "/api/mobile" || pathname.startsWith("/api/mobile/");
}

export function isSafetyRoute(pathname: string): boolean {
  return SAFETY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** The platform's own header first (a client cannot set it on Vercel), then the standard proxy headers. */
function clientIp(headers: Headers): string {
  const vercel = headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0]!.trim();
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}

async function sessionKey(headers: Headers): Promise<string | null> {
  const match = /^bearer\s+(\S+)/i.exec(headers.get("authorization") ?? "");
  if (!match) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(match[1]!));
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Null when the request may proceed, else the 429 response to return. */
export async function mobileApiRateLimitResponse(headers: Headers, limit: LimitFn, pathname = ""): Promise<NextResponse | null> {
  try {
    const key = isSafetyRoute(pathname) ? null : await sessionKey(headers);
    // Both checks at once: one round trip to the shared store, not two in a row.
    const [ip, session] = await Promise.all([
      limit(`mobile:ip:${clientIp(headers)}`, MOBILE_IP_RULE),
      key ? limit(`mobile:session:${key}`, MOBILE_SESSION_RULE) : Promise.resolve({ success: true, retryAfterSeconds: 0 }),
    ]);
    if (ip.success && session.success) return null;
    const retryAfter = Math.max(1, ip.success ? session.retryAfterSeconds : ip.retryAfterSeconds);
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  } catch {
    return null;
  }
}
