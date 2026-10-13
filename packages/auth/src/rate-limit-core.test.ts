import { describe, expect, it } from "@jest/globals";
import { createRateLimiter, type SharedLimitStore } from "./rate-limit-core";

const RULE = { limit: 2, windowSeconds: 60 };

/** A fake shared store that counts like Redis would: one counter per key, shared by every limiter pointed at it. */
function fakeStore(clock: () => number): SharedLimitStore & { calls: number } {
  const counts = new Map<string, { n: number; reset: number }>();
  const store = {
    calls: 0,
    async limit(key: string, rule: { limit: number; windowSeconds: number }) {
      store.calls += 1;
      const t = clock();
      const e = counts.get(key);
      if (!e || e.reset <= t) {
        counts.set(key, { n: 1, reset: t + rule.windowSeconds * 1000 });
        return { success: true, reset: t + rule.windowSeconds * 1000 };
      }
      e.n += 1;
      return { success: e.n <= rule.limit, reset: e.reset };
    },
  };
  return store;
}

describe("createRateLimiter without a shared store (in-process window)", () => {
  it("allows up to the limit, then denies with a positive retry-after", async () => {
    let t = 1_000_000;
    const { rateLimit } = createRateLimiter({ store: null, now: () => t });
    expect((await rateLimit("k", RULE)).success).toBe(true);
    expect((await rateLimit("k", RULE)).success).toBe(true);
    const denied = await rateLimit("k", RULE);
    expect(denied.success).toBe(false);
    expect(denied.retryAfterSeconds).toBe(60);
    t += 30_000;
    expect((await rateLimit("k", RULE)).retryAfterSeconds).toBe(30);
  });

  it("resets once the window elapses and keeps keys independent", async () => {
    let t = 0;
    const { rateLimit } = createRateLimiter({ store: null, now: () => t });
    await rateLimit("a", RULE);
    await rateLimit("a", RULE);
    expect((await rateLimit("a", RULE)).success).toBe(false);
    expect((await rateLimit("b", RULE)).success).toBe(true);
    t += 61_000;
    expect((await rateLimit("a", RULE)).success).toBe(true);
  });

  it("sweeps expired entries so memory cannot grow without bound", async () => {
    let t = 0;
    const l = createRateLimiter({ store: null, now: () => t });
    for (let i = 0; i < 50; i++) await l.rateLimit(`k${i}`, RULE);
    expect(l._memorySize()).toBe(50);
    t += 120_000;
    await l.rateLimit("fresh", RULE);
    expect(l._memorySize()).toBe(1);
  });
});

describe("createRateLimiter with a shared store (Upstash)", () => {
  it("decides in the shared store, so two instances share one count", async () => {
    const t = 5_000;
    const store = fakeStore(() => t);
    const instanceA = createRateLimiter({ store, now: () => t });
    const instanceB = createRateLimiter({ store, now: () => t });
    expect((await instanceA.rateLimit("login:ip:1.2.3.4", RULE)).success).toBe(true);
    expect((await instanceB.rateLimit("login:ip:1.2.3.4", RULE)).success).toBe(true);
    // third attempt lands on a different instance and is still refused: the in-process window alone would have allowed it
    const denied = await instanceA.rateLimit("login:ip:1.2.3.4", RULE);
    expect(denied.success).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(store.calls).toBe(3);
  });

  it("CONTROL: with no shared store the same two instances would each allow the third attempt (why Upstash matters)", async () => {
    const t = 5_000;
    const a = createRateLimiter({ store: null, now: () => t });
    const b = createRateLimiter({ store: null, now: () => t });
    await a.rateLimit("k", RULE);
    await b.rateLimit("k", RULE);
    expect((await a.rateLimit("k", RULE)).success).toBe(true);
  });

  it("falls back to the in-process window when the store errors, and warns at most once a minute", async () => {
    let t = 0;
    const warnings: string[] = [];
    const broken: SharedLimitStore = { limit: () => Promise.reject(new Error("redis down")) };
    const { rateLimit } = createRateLimiter({ store: broken, now: () => t, warn: (m) => warnings.push(m) });
    expect((await rateLimit("k", RULE)).success).toBe(true);
    expect((await rateLimit("k", RULE)).success).toBe(true);
    expect((await rateLimit("k", RULE)).success).toBe(false); // the local window still protects
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain("redis down"); // no error text echoed, only the error class
    t += 61_000;
    await rateLimit("k", RULE);
    expect(warnings).toHaveLength(2);
  });

  it("never lets a store error escape to the caller", async () => {
    const broken: SharedLimitStore = {
      limit: () => {
        throw new Error("sync throw");
      },
    };
    const { rateLimit } = createRateLimiter({ store: broken, warn: () => {} });
    await expect(rateLimit("k", RULE)).resolves.toEqual({ success: true, retryAfterSeconds: 0 });
  });
});
