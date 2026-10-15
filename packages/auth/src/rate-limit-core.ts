/**
 * The rate-limit decision logic, free of Next.js and of the Upstash SDK so it can be tested without either.
 * rate-limit.ts wires the real Upstash client in.
 *
 * Behaviour (SR1):
 *  - When a shared store is configured (Upstash Redis), every limit is decided there, so the count is correct across
 *    every serverless instance and region.
 *  - When it is not configured, an in-process sliding window decides (as before). It cannot coordinate across warm
 *    instances, which is why Upstash must be provisioned before launch (docs/runbooks/hosting-baseline-checklist.md).
 *  - When the shared store is configured but ERRORS (outage, timeout), the in-process window decides for that call and
 *    a warning is logged at most once a minute. Failing open to the local window is deliberate: a Redis outage must
 *    not lock every patient and clinician out of signing in, and the local window is still real protection.
 */

export type RateLimitResult = { success: boolean; retryAfterSeconds: number };
export type RateLimitRule = { limit: number; windowSeconds: number };

/** What the limiter needs from a shared store: decide one key, say when the window resets (epoch ms). */
export interface SharedLimitStore {
  limit(key: string, rule: RateLimitRule): Promise<{ success: boolean; reset: number }>;
}

type MemoryEntry = { count: number; resetAt: number };

export interface RateLimiterOptions {
  store: SharedLimitStore | null;
  now?: () => number;
  warn?: (message: string) => void;
}

export function createRateLimiter({ store, now = Date.now, warn = (m) => console.warn(m) }: RateLimiterOptions) {
  const memory = new Map<string, MemoryEntry>();
  let lastSweep = now();
  let lastWarn = Number.NEGATIVE_INFINITY;

  /** Drops expired entries so a long-lived warm instance cannot grow without bound; at most once a minute, on the calling path. */
  function sweep() {
    const t = now();
    if (t - lastSweep < 60_000) return;
    lastSweep = t;
    for (const [key, entry] of memory) if (entry.resetAt <= t) memory.delete(key);
  }

  function checkMemory(key: string, { limit, windowSeconds }: RateLimitRule): RateLimitResult {
    sweep();
    const t = now();
    const entry = memory.get(key);
    if (!entry || entry.resetAt <= t) {
      memory.set(key, { count: 1, resetAt: t + windowSeconds * 1000 });
      return { success: true, retryAfterSeconds: 0 };
    }
    if (entry.count >= limit) return { success: false, retryAfterSeconds: Math.ceil((entry.resetAt - t) / 1000) };
    entry.count += 1;
    return { success: true, retryAfterSeconds: 0 };
  }

  async function rateLimit(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    if (store) {
      try {
        const result = await store.limit(key, rule);
        return {
          success: result.success,
          retryAfterSeconds: result.success ? 0 : Math.max(1, Math.ceil((result.reset - now()) / 1000)),
        };
      } catch (err) {
        const t = now();
        if (t - lastWarn >= 60_000) {
          lastWarn = t;
          warn(`rate-limit: shared store failed, using the in-process window (${err instanceof Error ? err.name : "error"})`);
        }
        // fall through to the local window
      }
    }
    return checkMemory(key, rule);
  }

  return { rateLimit, /** test hook */ _memorySize: () => memory.size };
}
