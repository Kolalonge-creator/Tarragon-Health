/** Big-number tiles: a neutral word for the month's direction (never a judgement), and a plain "when". */
import { trendWord, whenLabel } from "./trend-word";
import { sparkPath } from "@/components/charts/sparkline";

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

describe("sparkPath", () => {
  it("draws nothing for fewer than two points and centres a flat line", () => {
    expect(sparkPath([{ t: 1, v: 5 }], 100, 30)).toBeNull();
    const flat = sparkPath([{ t: 1, v: 5 }, { t: 2, v: 5 }], 100, 30)!;
    expect(flat.last.y).toBe(15);
  });
});
