import { glucoseTrendBand, weightTrendBand } from "@tarragon/shared";
import { buildSeriesModel, windowSeries } from "./series-band-model";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const DAY = 86_400_000;

describe("windowSeries", () => {
  it("keeps readings inside the window, oldest first, and drops unreadable ones", () => {
    const rows = windowSeries(
      [
        { atMs: NOW - 2 * DAY, value: 6 },
        { atMs: NOW - 40 * DAY, value: 9 },
        { atMs: NOW + DAY, value: 9 },
        { atMs: Number.NaN, value: 9 },
        { atMs: NOW - 5 * DAY, value: Number.NaN },
        { atMs: NOW - 10 * DAY, value: 5 },
      ],
      30,
      NOW,
    );
    expect(rows.map((r) => r.value)).toEqual([5, 6]);
  });
});

describe("buildSeriesModel", () => {
  it("is null with nothing to draw", () => {
    expect(buildSeriesModel([], 30, NOW, null)).toBeNull();
  });

  it("places points left to right and the band as a fraction of the box, always inside it", () => {
    const band = glucoseTrendBand("mmol_l");
    const m = buildSeriesModel([{ atMs: NOW - 20 * DAY, value: 5 }, { atMs: NOW - DAY, value: 12 }], 30, NOW, band)!;
    expect(m.count).toBe(2);
    expect(m.min).toBe(5);
    expect(m.max).toBe(12);
    expect(m.latest).toBe(12);
    expect(m.points[0]!.x).toBeLessThan(m.points[1]!.x);
    for (const p of m.points) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
    expect(m.band!.bottom).toBeGreaterThanOrEqual(0);
    expect(m.band!.top).toBeLessThanOrEqual(1);
    expect(m.band!.top).toBeGreaterThan(m.band!.bottom);
  });

  it("widens the range to include a band that the readings do not reach", () => {
    const m = buildSeriesModel([{ atMs: NOW - DAY, value: 5 }], 30, NOW, glucoseTrendBand("mmol_l"))!;
    expect(m.yMax).toBeGreaterThanOrEqual(10);
    expect(m.band!.top).toBeLessThanOrEqual(1);
  });

  it("has no band when none applies, and copes with a single flat value", () => {
    const m = buildSeriesModel([{ atMs: NOW - DAY, value: 70 }, { atMs: NOW - 2 * DAY, value: 70 }], 30, NOW, null)!;
    expect(m.band).toBeNull();
    expect(m.yMax).toBeGreaterThan(m.yMin);
  });

  it("copes with zero values", () => {
    const m = buildSeriesModel([{ atMs: NOW - DAY, value: 0 }], 30, NOW, null)!;
    expect(m.yMax).toBeGreaterThan(m.yMin);
  });

  it("uses the weight band at the person's height, and none without a height", () => {
    expect(weightTrendBand(null)).toBeNull();
    const band = weightTrendBand(170)!;
    const m = buildSeriesModel([{ atMs: NOW - DAY, value: 80 }], 30, NOW, band)!;
    expect(m.band).not.toBeNull();
  });
});
