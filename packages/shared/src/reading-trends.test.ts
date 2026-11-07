/** Big-number tiles (web and phone): a neutral word for the month's direction (never a judgement), a plain "when", the trend line, and the reading rules. */
import { describe, expect, it } from "@jest/globals";
import {
  isSeriesPin,
  parsePinSeries,
  pinSeriesColumn,
  pinSeriesExcludesWearable,
  pinSeriesVitalType,
  readingDetail,
  sparkPath,
  trendWord,
  whenLabel,
} from "./reading-trends";

const NOW = Date.parse("2026-11-06T17:00:00Z");
const DAY = 86_400_000;
const pts = (pairs: [number, number][]) => pairs.map(([daysAgo, v]) => ({ t: NOW - daysAgo * DAY, v }));

describe("trendWord", () => {
  it("is steady within 3 percent, and says higher or lower otherwise", () => {
    expect(trendWord(pts([[1, 100], [2, 101], [10, 100], [15, 100]]), NOW)).toBe("Steady this month");
    expect(trendWord(pts([[1, 120], [2, 118], [10, 100], [15, 102]]), NOW)).toBe("Higher than earlier this month");
    expect(trendWord(pts([[1, 80], [2, 82], [10, 100], [15, 102]]), NOW)).toBe("Lower than earlier this month");
  });

  it("says nothing without two readings on each side", () => {
    expect(trendWord(pts([[1, 120], [10, 100], [15, 102]]), NOW)).toBeNull();
    expect(trendWord(pts([[1, 120], [2, 118], [10, 100]]), NOW)).toBeNull();
  });
});

describe("whenLabel", () => {
  it("uses Lagos days", () => {
    expect(whenLabel(Date.parse("2026-11-06T07:10:00Z"), NOW)).toBe("Today, 08:10");
    // 23:30 UTC on the 5th is 00:30 on the 6th in Lagos: today, not yesterday.
    expect(whenLabel(Date.parse("2026-11-05T23:30:00Z"), NOW)).toBe("Today, 00:30");
    expect(whenLabel(Date.parse("2026-11-05T10:00:00Z"), NOW)).toBe("Yesterday");
    expect(whenLabel(Date.parse("2026-11-03T10:00:00Z"), NOW)).toBe("3 days ago");
    expect(whenLabel(Date.parse("2026-10-12T10:00:00Z"), NOW)).toBe("12 Oct");
  });
});

describe("readingDetail", () => {
  it("joins when and the trend word, and says nothing with no reading", () => {
    expect(readingDetail({ latestAt: null, points: [] }, NOW)).toBeNull();
    expect(readingDetail({ latestAt: Date.parse("2026-11-05T10:00:00Z"), points: [] }, NOW)).toBe("Yesterday");
    expect(readingDetail({ latestAt: Date.parse("2026-11-05T10:00:00Z"), points: pts([[1, 100], [2, 101], [10, 100], [15, 100]]) }, NOW)).toBe(
      "Yesterday · Steady this month",
    );
  });
});

describe("sparkPath", () => {
  it("draws nothing for fewer than two points and centres a flat line", () => {
    expect(sparkPath([{ t: 1, v: 5 }], 100, 30)).toBeNull();
    const flat = sparkPath([{ t: 1, v: 5 }, { t: 2, v: 5 }], 100, 30)!;
    expect(flat.last.y).toBe(15);
  });
  it("puts the latest point on the right and the highest value at the top", () => {
    const p = sparkPath([{ t: 2, v: 10 }, { t: 1, v: 0 }], 100, 30, 0)!;
    expect(p.d).toBe("M0.0,30.0 L100.0,0.0");
    expect(p.last).toEqual({ x: 100, y: 0 });
  });
});

describe("series reading rules", () => {
  it("charts the top blood pressure number and never a wearable estimate for bp, pulse, oxygen or temperature", () => {
    expect(pinSeriesColumn("bp")).toBe("systolic");
    expect(pinSeriesColumn("glucose")).toBe("glucose_mmol_l");
    expect(pinSeriesColumn("weight")).toBe("weight_kg");
    expect(pinSeriesVitalType("bp")).toBe("blood_pressure");
    for (const k of ["bp", "pulse", "spo2", "temperature"] as const) expect(pinSeriesExcludesWearable(k)).toBe(true);
    for (const k of ["glucose", "weight", "waist", "peak_flow"] as const) expect(pinSeriesExcludesWearable(k)).toBe(false);
  });
  it("only vitals pins have a series", () => {
    expect(isSeriesPin("bp")).toBe(true);
    expect(isSeriesPin("weight")).toBe(true);
    expect(isSeriesPin("active_meds")).toBe(false);
    expect(isSeriesPin("doses_today")).toBe(false);
  });
});

describe("parsePinSeries", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  it("keeps the latest reading even when it is older than 30 days, and charts only the last 30, oldest first", () => {
    const s = parsePinSeries(
      [
        { taken_at: "2026-11-05T08:00:00Z", weight_kg: 74 },
        { taken_at: "2026-10-20T08:00:00Z", weight_kg: 75 },
        { taken_at: "2026-08-01T08:00:00Z", weight_kg: 78 },
      ],
      "weight_kg",
      now,
    );
    expect(s.latestValue).toBe(74);
    expect(s.latestAt).toBe(Date.parse("2026-11-05T08:00:00Z"));
    expect(s.points.map((p) => p.v)).toEqual([75, 74]);
    const old = parsePinSeries([{ taken_at: "2026-08-01T08:00:00Z", weight_kg: 78 }], "weight_kg", now);
    expect(old.latestValue).toBe(78);
    expect(old.points).toEqual([]);
  });
  it("drops rows without a usable time or number, and is empty with no rows", () => {
    const s = parsePinSeries([{ taken_at: "nope", weight_kg: 70 }, { taken_at: "2026-11-05T08:00:00Z", weight_kg: null }], "weight_kg", now);
    expect(s).toEqual({ latestAt: null, latestValue: null, points: [] });
  });
});
