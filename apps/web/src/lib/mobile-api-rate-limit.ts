import { NextResponse } from "next/server";

/**
 * A request-rate limit for every /api/mobile/* route, applied once in the proxy (OQ-267: of 37 mobile routes only four had any limit).
 *
 * Two buckets, both deliberately generous because the app syncs queued readings in bursts after a patient comes back online:
 *  - per SESSION (a hash of the bearer token): 240 requests a minute. This is the real limit.
 *  - per IP: 3000 a minute. A flood cap only. Many phones share one mobile-carrier address in Nigeria, so a tight per-IP limit
 *    would lock out unrelated patients; the session bucket is what stops one logged-in client hammering an endpoint.
 * The session key is a hash of the token string exactly as sent, never a decoded user id: an unverified id would let anyone
 * spend a victim's allowance. A forged or random token only gets a fresh bucket of its own, still bound by the IP cap.
 *
 * Fails open: if this code throws for any reason the request goes on to the route, which still authenticates it. The limiter
 * itself (packages/auth/src/rate-limit-core.ts) already falls back to an in-process window when Upstash is unset or down.
 */

export type LimitFn = (key: string, rule: { limit: number; windowSeconds: number }) => Promise<{ success: boolean; retryAfterSeconds: number }>;

export const MOBILE_SESSION_RULE = { limit: 240, windowSeconds: 60 } as const;
export const MOBILE_IP_RULE = { limit: 3000, windowSeconds: 60 } as const;

export function isMobileApiPath(pathname: string): boolean {
  return pathname === "/api/mobile" || pathname.startsWith("/api/mobile/");
}

function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}

async function sessionKey(headers: Headers): Promise<string | null> {
  const auth = headers.get("authorization");
  if (!auth || !/^bearer\s+\S+/i.test(auth)) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(auth.trim()));
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Null when the request may proceed, else the 429 response to return. */
export async function mobileApiRateLimitResponse(headers: Headers, limit: LimitFn): Promise<NextResponse | null> {
  try {
    const ip = await limit(`mobile:ip:${clientIp(headers)}`, MOBILE_IP_RULE);
    const key = await sessionKey(headers);
    const session = key ? await limit(`mobile:session:${key}`, MOBILE_SESSION_RULE) : { success: true, retryAfterSeconds: 0 };
    if (ip.success && session.success) return null;
    const retryAfter = Math.max(1, ip.success ? session.retryAfterSeconds : ip.retryAfterSeconds);
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  } catch {
    return null;
  }
}
