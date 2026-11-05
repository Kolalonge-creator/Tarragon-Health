/**
 * @jest-environment node
 *
 * Security audit 2026-11-05, M-8. The real limiter runs here (no Upstash in tests, so its in-process window), keyed per kind
 * and subject, with the numbers from the registry key security.abuse_rate_limits.
 */
jest.mock("next/headers", () => ({ headers: jest.fn().mockResolvedValue(new Map()) }));

import { abuseLimitRules, checkAbuseLimit, type AbuseLimitKind } from "./abuse-limits";

const KINDS: AbuseLimitKind[] = ["page_view", "upload", "meal_photo_ai", "add_dependant"];

describe("checkAbuseLimit", () => {
  it("has at least one positive window for every kind", () => {
    for (const kind of KINDS) {
      const rules = abuseLimitRules(kind);
      expect(rules.length).toBeGreaterThan(0);
      for (const r of rules) {
        expect(r.limit).toBeGreaterThan(0);
        expect(r.window_seconds).toBeGreaterThan(0);
      }
    }
  });

  it("allows up to the tightest limit, then refuses with a retry time", async () => {
    const subject = `user-${Math.random()}`;
    const tightest = Math.min(...abuseLimitRules("add_dependant").map((r) => r.limit));
    for (let i = 0; i < tightest; i++) {
      expect((await checkAbuseLimit("add_dependant", subject)).ok).toBe(true);
    }
    const refused = await checkAbuseLimit("add_dependant", subject);
    expect(refused).toEqual({ ok: false, retryAfterSeconds: expect.any(Number) });
    if (!refused.ok) expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("keeps subjects and kinds apart", async () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    const tightest = Math.min(...abuseLimitRules("add_dependant").map((r) => r.limit));
    for (let i = 0; i <= tightest; i++) await checkAbuseLimit("add_dependant", a);
    expect((await checkAbuseLimit("add_dependant", a)).ok).toBe(false);
    expect((await checkAbuseLimit("add_dependant", b)).ok).toBe(true);
    expect((await checkAbuseLimit("upload", a)).ok).toBe(true);
  });
});
