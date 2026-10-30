import {
  isMobileApiPath,
  isSafetyRoute,
  mobileApiRateLimitResponse,
  MOBILE_IP_RULE,
  MOBILE_SESSION_RULE,
  type LimitFn,
} from "./mobile-api-rate-limit";

/** A limiter that really counts, so the test proves behaviour and not just that a function was called. */
function countingLimiter(): { limit: LimitFn; seen: string[] } {
  const counts = new Map<string, number>();
  const seen: string[] = [];
  const limit: LimitFn = async (key, rule) => {
    seen.push(key);
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return { success: n <= rule.limit, retryAfterSeconds: n <= rule.limit ? 0 : 17 };
  };
  return { limit, seen };
}

const headers = (init: Record<string, string>) => new Headers(init);

describe("mobile API rate limit", () => {
  it("only applies to /api/mobile paths", () => {
    expect(isMobileApiPath("/api/mobile/vitals")).toBe(true);
    expect(isMobileApiPath("/api/mobile")).toBe(true);
    expect(isMobileApiPath("/api/mobilexyz")).toBe(false);
    expect(isMobileApiPath("/api/status")).toBe(false);
    expect(isMobileApiPath("/patient")).toBe(false);
  });

  it("lets a session through up to its limit and returns 429 with Retry-After on the next request", async () => {
    const { limit } = countingLimiter();
    const h = headers({ authorization: "Bearer token-a", "x-forwarded-for": "10.0.0.1" });
    for (let i = 0; i < MOBILE_SESSION_RULE.limit; i++) expect(await mobileApiRateLimitResponse(h, limit)).toBeNull();
    const blocked = await mobileApiRateLimitResponse(h, limit);
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get("Retry-After")).toBe("17");
    expect(await blocked?.json()).toEqual({ error: "rate_limited" });
  });

  it("does not let one session spend another session's allowance, even from the same shared IP", async () => {
    const { limit } = countingLimiter();
    const a = headers({ authorization: "Bearer token-a", "x-forwarded-for": "10.0.0.1" });
    const b = headers({ authorization: "Bearer token-b", "x-forwarded-for": "10.0.0.1" });
    for (let i = 0; i <= MOBILE_SESSION_RULE.limit; i++) await mobileApiRateLimitResponse(a, limit);
    expect((await mobileApiRateLimitResponse(a, limit))?.status).toBe(429);
    expect(await mobileApiRateLimitResponse(b, limit)).toBeNull();
  });

  it("keys the session bucket on a hash of the token, never on the token or a decoded user id", async () => {
    const { limit, seen } = countingLimiter();
    await mobileApiRateLimitResponse(headers({ authorization: "Bearer secret-token-value" }), limit);
    const sessionKeys = seen.filter((k) => k.startsWith("mobile:session:"));
    expect(sessionKeys).toHaveLength(1);
    expect(sessionKeys[0]).toMatch(/^mobile:session:[0-9a-f]{16}$/);
    expect(seen.join(" ")).not.toContain("secret-token-value");
  });

  it("applies the flood cap per IP and returns 429 once it is passed, whatever the token", async () => {
    const { limit } = countingLimiter();
    for (let i = 0; i < MOBILE_IP_RULE.limit; i++) {
      expect(await mobileApiRateLimitResponse(headers({ authorization: `Bearer t-${i}`, "x-forwarded-for": "10.9.9.9" }), limit)).toBeNull();
    }
    expect((await mobileApiRateLimitResponse(headers({ authorization: "Bearer another", "x-forwarded-for": "10.9.9.9" }), limit))?.status).toBe(429);
    expect(await mobileApiRateLimitResponse(headers({ authorization: "Bearer another", "x-forwarded-for": "10.9.9.8" }), limit)).toBeNull();
  });

  it("uses the first forwarded address and falls back to x-real-ip, then a shared 'unknown' bucket", async () => {
    const { limit, seen } = countingLimiter();
    await mobileApiRateLimitResponse(headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }), limit);
    await mobileApiRateLimitResponse(headers({ "x-real-ip": "3.3.3.3" }), limit);
    await mobileApiRateLimitResponse(headers({}), limit);
    expect(seen).toEqual(["mobile:ip:1.1.1.1", "mobile:ip:3.3.3.3", "mobile:ip:unknown"]);
  });

  it("skips the session bucket when there is no bearer token", async () => {
    const { limit, seen } = countingLimiter();
    await mobileApiRateLimitResponse(headers({ authorization: "Basic abc", "x-forwarded-for": "1.1.1.1" }), limit);
    expect(seen.filter((k) => k.startsWith("mobile:session:"))).toHaveLength(0);
  });

  it("gives one session one bucket whatever the scheme casing or spacing of its Authorization header", async () => {
    const { limit, seen } = countingLimiter();
    await mobileApiRateLimitResponse(headers({ authorization: "Bearer same-token" }), limit);
    await mobileApiRateLimitResponse(headers({ authorization: "bearer  same-token" }), limit);
    await mobileApiRateLimitResponse(headers({ authorization: "BEARER same-token " }), limit);
    const sessionKeys = new Set(seen.filter((k) => k.startsWith("mobile:session:")));
    expect(sessionKeys.size).toBe(1);
  });

  it("never session-limits a safety route, so a saturated sync cannot delay a dangerous reading or an emergency", async () => {
    const { limit } = countingLimiter();
    const h = headers({ authorization: "Bearer busy-sync-session", "x-forwarded-for": "10.7.7.7" });
    for (let i = 0; i < MOBILE_SESSION_RULE.limit + 50; i++) {
      expect(await mobileApiRateLimitResponse(h, limit, "/api/mobile/vitals")).toBeNull();
    }
    for (const path of ["/api/mobile/symptom-describe-danger", "/api/mobile/community-emergency", "/api/mobile/device-readings", "/api/mobile/cgm-readings"]) {
      expect(await mobileApiRateLimitResponse(h, limit, path)).toBeNull();
    }
    // the same saturated session IS limited on an ordinary route
    for (let i = 0; i < MOBILE_SESSION_RULE.limit; i++) await mobileApiRateLimitResponse(h, limit, "/api/mobile/lifestyle");
    expect((await mobileApiRateLimitResponse(h, limit, "/api/mobile/lifestyle"))?.status).toBe(429);
    expect(isSafetyRoute("/api/mobile/vitals/anything")).toBe(true);
    expect(isSafetyRoute("/api/mobile/vitals-thresholds")).toBe(false);
  });

  it("still applies the IP flood cap to safety routes", async () => {
    const { limit } = countingLimiter();
    for (let i = 0; i < MOBILE_IP_RULE.limit; i++) await mobileApiRateLimitResponse(headers({ "x-forwarded-for": "10.8.8.8" }), limit, "/api/mobile/vitals");
    expect((await mobileApiRateLimitResponse(headers({ "x-forwarded-for": "10.8.8.8" }), limit, "/api/mobile/vitals"))?.status).toBe(429);
  });

  it("prefers the platform's own forwarded-for header, which a client cannot set, over x-forwarded-for", async () => {
    const { limit, seen } = countingLimiter();
    await mobileApiRateLimitResponse(headers({ "x-vercel-forwarded-for": "9.9.9.9", "x-forwarded-for": "6.6.6.6" }), limit);
    expect(seen).toEqual(["mobile:ip:9.9.9.9"]);
  });

  it("checks the IP and the session together, so a refused IP is not a reason to skip counting", async () => {
    const calls: string[] = [];
    const slow: LimitFn = async (key) => {
      calls.push(`start:${key}`);
      await new Promise((r) => setTimeout(r, 5));
      calls.push(`end:${key}`);
      return { success: true, retryAfterSeconds: 0 };
    };
    await mobileApiRateLimitResponse(headers({ authorization: "Bearer p", "x-forwarded-for": "1.2.3.4" }), slow);
    expect(calls[0]).toMatch(/^start:/);
    expect(calls[1]).toMatch(/^start:/);
  });

  it("fails open when the limiter itself throws, so a bug here cannot lock patients out", async () => {
    const broken: LimitFn = async () => {
      throw new Error("redis exploded");
    };
    expect(await mobileApiRateLimitResponse(headers({ authorization: "Bearer x" }), broken)).toBeNull();
  });
});
