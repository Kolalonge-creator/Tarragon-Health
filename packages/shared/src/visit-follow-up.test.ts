import { describe, expect, it, jest } from "@jest/globals";
import { loadVisitFollowUpConfig, visitFollowUpOpen } from "./visit-follow-up";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const CFG = { version: 1, windowMs: 7 * DAY };
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("visitFollowUpOpen", () => {
  it("is open from approval until the window ends, and not after", () => {
    expect(visitFollowUpOpen(ago(0), NOW, CFG)).toBe(true);
    expect(visitFollowUpOpen(ago(3 * DAY), NOW, CFG)).toBe(true);
    expect(visitFollowUpOpen(ago(7 * DAY - 1), NOW, CFG)).toBe(true);
    expect(visitFollowUpOpen(ago(7 * DAY), NOW, CFG)).toBe(false);
    expect(visitFollowUpOpen(ago(30 * DAY), NOW, CFG)).toBe(false);
  });
  it("shows nothing for a missing, unreadable or future approval time (no guess)", () => {
    for (const v of [null, undefined, "", "garbage"]) expect(visitFollowUpOpen(v, NOW, CFG)).toBe(false);
    expect(visitFollowUpOpen(new Date(NOW + 2 * 60 * 60_000).toISOString(), NOW, CFG)).toBe(false);
    expect(visitFollowUpOpen(ago(0), Number.NaN, CFG)).toBe(false);
  });
  it("a small clock difference does not hide it", () => {
    expect(visitFollowUpOpen(new Date(NOW + 2 * 60_000).toISOString(), NOW, CFG)).toBe(true);
  });
  it("reads its window from versioned configuration", () => {
    const c = loadVisitFollowUpConfig();
    expect(c.version).toBeGreaterThanOrEqual(1);
    expect(c.windowMs).toBe(7 * DAY);
  });
});

describe("a device with the wrong date", () => {
  it("still loads the window instead of throwing", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2025-01-01T00:00:00Z"));
    try {
      expect(() => loadVisitFollowUpConfig()).not.toThrow();
      expect(visitFollowUpOpen(new Date("2025-01-01T00:00:00Z").toISOString(), Date.now())).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
