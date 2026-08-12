import { headers } from "next/headers";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Rate limiting for auth endpoints (login, signup, password reset, MFA
 * challenge) — the credential-stuffing / brute-force / SMS-bombing surface
 * a 2026-08-12 security audit flagged as unverified.
 *
 * CLAUDE.md lists Upstash Redis as this platform's cache/queue layer, but as
 * of this writing no project has ever actually set
 * UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN — grepping the whole repo
 * turns up zero references anywhere. Rather than ship a limiter that's
 * silently inert until someone provisions Redis, this uses Upstash
 * automatically the moment those two env vars exist (real distributed
 * limiting, correct across every serverless instance and region) and falls
 * back to an in-process sliding window otherwise. The in-memory path is
 * real, active protection today — it just can't coordinate across separate
 * warm instances, so a determined attacker spread across many concurrent
 * Vercel invocations could exceed the nominal limit. That's a materially
 * better place to be than no limiting at all, and it's a zero-code-change
 * upgrade once Redis is provisioned.
 */

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

const upstashLimiters = new Map<string, Ratelimit>();

function getUpstashLimiter(limit: number, windowSeconds: number): Ratelimit {
  const cacheKey = `${limit}:${windowSeconds}`;
  const existing = upstashLimiters.get(cacheKey);
  if (existing) return existing;

  const created = new Ratelimit({
    redis: redis!,
    limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
    prefix: "th-ratelimit",
  });
  upstashLimiters.set(cacheKey, created);
  return created;
}

type MemoryEntry = { count: number; resetAt: number };
const memoryStore = new Map<string, MemoryEntry>();
let lastSweep = Date.now();

/** Drops expired entries so a long-lived warm instance's memoryStore can't
 * grow without bound. Runs at most once a minute, on the calling path —
 * no background timer, which would keep a serverless instance alive. */
function sweepMemoryStore() {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, entry] of memoryStore) {
    if (entry.resetAt <= now) memoryStore.delete(key);
  }
}

function checkMemory(
  key: string,
  limit: number,
  windowSeconds: number
): { success: boolean; retryAfterSeconds: number } {
  sweepMemoryStore();
  const now = Date.now();
  const entry = memoryStore.get(key);

  if (!entry || entry.resetAt <= now) {
    memoryStore.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { success: true, retryAfterSeconds: 0 };
  }
  if (entry.count >= limit) {
    return { success: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count += 1;
  return { success: true, retryAfterSeconds: 0 };
}

export type RateLimitResult = { success: boolean; retryAfterSeconds: number };

export async function rateLimit(
  key: string,
  { limit, windowSeconds }: { limit: number; windowSeconds: number }
): Promise<RateLimitResult> {
  if (redis) {
    const limiter = getUpstashLimiter(limit, windowSeconds);
    const result = await limiter.limit(key);
    return {
      success: result.success,
      retryAfterSeconds: result.success
        ? 0
        : Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
    };
  }
  return checkMemory(key, limit, windowSeconds);
}

/**
 * Best-effort caller IP from the standard proxy headers Vercel sets on every
 * request. Never throws — an auth action must keep working even when this
 * can't be determined; an unresolved IP just shares one "unknown" bucket
 * rather than blocking the request outright.
 */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]!.trim();
  }
  return h.get("x-real-ip") ?? "unknown";
}

export const RATE_LIMIT_MESSAGE = "Too many attempts — please wait a moment and try again.";

/**
 * Checks both an IP-scoped limit (catches one source hammering many
 * accounts) and, when an identifier is given, an identifier-scoped limit
 * (catches many sources targeting one account/number/email — the case an
 * IP-only limit misses entirely). Denies if either is exceeded.
 */
export async function checkAuthRateLimit(
  scope: string,
  identifier: string | null,
  ipLimit: { limit: number; windowSeconds: number },
  identifierLimit?: { limit: number; windowSeconds: number }
): Promise<RateLimitResult> {
  const ip = await getClientIp();
  const byIp = await rateLimit(`${scope}:ip:${ip}`, ipLimit);
  if (!byIp.success) return byIp;

  if (identifier && identifierLimit) {
    const byIdentifier = await rateLimit(`${scope}:id:${identifier.toLowerCase()}`, identifierLimit);
    if (!byIdentifier.success) return byIdentifier;
  }

  return { success: true, retryAfterSeconds: 0 };
}
