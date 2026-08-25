// getClientIp() needs a live Next.js request context; checkAuthRateLimit()
// calls it internally, so it's stubbed here purely to make the function
// callable under Jest — real IP extraction is exercised via the running app,
// per this file's jest.config.mjs boundary comment (pure logic here, Server
// Actions/Route Handlers live).
jest.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
}));

import { rateLimit, checkAuthRateLimit } from "./rate-limit";

/**
 * Only the in-memory path is exercised here — no UPSTASH_REDIS_REST_URL/
 * TOKEN in the test environment, so `rateLimit()` always takes the fallback
 * branch.
 */
describe("rateLimit", () => {
  it("allows requests up to the limit", async () => {
    const key = `test-allow-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      const result = await rateLimit(key, { limit: 3, windowSeconds: 60 });
      expect(result.success).toBe(true);
    }
  });

  it("denies once the limit is exceeded, with a positive retry-after", async () => {
    const key = `test-deny-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      await rateLimit(key, { limit: 3, windowSeconds: 60 });
    }
    const denied = await rateLimit(key, { limit: 3, windowSeconds: 60 });
    expect(denied.success).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks separate keys independently", async () => {
    const keyA = `test-isolated-a-${Math.random()}`;
    const keyB = `test-isolated-b-${Math.random()}`;
    for (let i = 0; i < 2; i++) {
      await rateLimit(keyA, { limit: 2, windowSeconds: 60 });
    }
    const deniedA = await rateLimit(keyA, { limit: 2, windowSeconds: 60 });
    const allowedB = await rateLimit(keyB, { limit: 2, windowSeconds: 60 });
    expect(deniedA.success).toBe(false);
    expect(allowedB.success).toBe(true);
  });

  it("resets once the window elapses", async () => {
    const key = `test-reset-${Math.random()}`;
    await rateLimit(key, { limit: 1, windowSeconds: 0 });
    const secondImmediately = await rateLimit(key, { limit: 1, windowSeconds: 0 });
    // windowSeconds: 0 means every check is already past its own reset time.
    expect(secondImmediately.success).toBe(true);
  });
});

describe("checkAuthRateLimit", () => {
  it("denies on the identifier limit even when every request comes from a fresh IP", async () => {
    const scope = `test-scope-${Math.random()}`;
    const identifier = "same-target@example.com";
    for (let i = 0; i < 2; i++) {
      const result = await checkAuthRateLimit(
        scope,
        identifier,
        { limit: 100, windowSeconds: 60 }, // effectively unlimited per-IP
        { limit: 2, windowSeconds: 60 }
      );
      expect(result.success).toBe(true);
    }
    const denied = await checkAuthRateLimit(
      scope,
      identifier,
      { limit: 100, windowSeconds: 60 },
      { limit: 2, windowSeconds: 60 }
    );
    expect(denied.success).toBe(false);
  });
});
