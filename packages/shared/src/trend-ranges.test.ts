import { describe, expect, it } from "@jest/globals";
import {
  parseTrendRange,
  pointsInTrendRange,
  TREND_MAX_POINTS,
  TREND_RANGE_LABEL,
  TREND_RANGES,
  trendHitCap,
  trendRangeStart,
} from "./trend-ranges";

const now = new Date("2026-10-29T12:00:00Z");

describe("trend ranges", () => {
  it("is the one six-range set, in order, each with a label", () => {
    expect([...TREND_RANGES]).toEqual(["7d", "30d", "90d", "6m", "12m", "all"]);
    for (const r of TREND_RANGES) expect(TREND_RANGE_LABEL[r]).toMatch(/\S/);
  });

  it("parses known values, maps the old biomarker links, and falls back otherwise", () => {
    expect(parseTrendRange("6m", "all")).toBe("6m");
    expect(parseTrendRange("3m", "all")).toBe("90d");
    expect(parseTrendRange("1y", "all")).toBe("12m");
    expect(parseTrendRange("bogus", "90d")).toBe("90d");
    expect(parseTrendRange(undefined, "all")).toBe("all");
  });

  it("day ranges are exact 24-hour multiples back", () => {
    expect(trendRangeStart("7d", now)?.toISOString()).toBe("2026-10-22T12:00:00.000Z");
    expect(trendRangeStart("30d", now)?.toISOString()).toBe("2026-09-29T12:00:00.000Z");
    expect(trendRangeStart("90d", now)?.toISOString()).toBe("2026-07-31T12:00:00.000Z");
  });

  it("month ranges are calendar months, clamped at month end", () => {
    expect(trendRangeStart("12m", now)?.toISOString()).toBe("2025-10-29T12:00:00.000Z");
    expect(trendRangeStart("6m", new Date("2026-08-31T12:00:00Z"))?.toISOString()).toBe("2026-02-28T12:00:00.000Z");
  });

  it("reports a capped read only when more than the cap came back", () => {
    expect(trendHitCap(TREND_MAX_POINTS)).toBe(false);
    expect(trendHitCap(TREND_MAX_POINTS + 1)).toBe(true);
    expect(trendHitCap(0)).toBe(false);
  });

  it("all has no start", () => {
    expect(trendRangeStart("all", now)).toBeNull();
  });

  it("keeps only points inside the window and never changes or adds one", () => {
    const pts = [{ t: "2026-07-30T00:00:00Z", v: 1 }, { t: "2026-08-01T00:00:00Z", v: 2 }, { t: "2026-10-28T00:00:00Z", v: 3 }];
    expect(pointsInTrendRange(pts, (p) => p.t, "90d", now)).toEqual([pts[1], pts[2]]);
    expect(pointsInTrendRange(pts, (p) => p.t, "7d", now)).toEqual([pts[2]]);
    expect(pointsInTrendRange(pts, (p) => p.t, "all", now)).toEqual(pts);
    expect(pointsInTrendRange([], (p: { t: string }) => p.t, "30d", now)).toEqual([]);
  });
});
