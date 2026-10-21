import { describe, expect, it } from "@jest/globals";
import { GLUCOSE_MMOL_TO_MGDL, mgDlToMmolL } from "@tarragon/shared";
import { FIXTURE_NOW as NOW, fortnight } from "./fixtures/agp-fortnight";
import { clockLabel, computeAgp, findPatterns, loadAgpConfig, percentile, roundShares, type AgpPattern } from "./agp";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();

const covers = (p: AgpPattern, minute: number): boolean =>
  p.startMinute < p.endMinute ? minute >= p.startMinute && minute < p.endMinute : minute >= p.startMinute || minute < p.endMinute;

describe("percentile", () => {
  it("interpolates between ranks", () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10, 20], 25)).toBe(12.5);
    expect(percentile([7], 90)).toBe(7);
  });
});

describe("roundShares", () => {
  it("always adds to exactly 100", () => {
    expect(roundShares([1, 1, 1]).reduce((s, n) => s + n, 0)).toBe(100);
    expect(roundShares([333, 333, 334, 0, 0]).reduce((s, n) => s + n, 0)).toBe(100);
    expect(roundShares([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe("computeAgp on a synthetic fortnight with night highs, a midday spike and evening lows", () => {
  const result = computeAgp(fortnight(), NOW);

  it("has enough data and 48 half hour bins", () => {
    expect(result.sufficient).toBe(true);
    expect(result.bins).toHaveLength(48);
    expect(result.metrics.daysWithData).toBeGreaterThanOrEqual(14);
    expect(result.metrics.activePct).toBeGreaterThan(95);
  });

  it("splits time into five bands that add to 100, with more time high than low", () => {
    const t = result.metrics.tir;
    expect(t).not.toBeNull();
    const sum = (t?.veryLowPct ?? 0) + (t?.lowPct ?? 0) + (t?.inRangePct ?? 0) + (t?.highPct ?? 0) + (t?.veryHighPct ?? 0);
    expect(sum).toBe(100);
    expect((t?.highPct ?? 0) + (t?.veryHighPct ?? 0)).toBeGreaterThan((t?.lowPct ?? 100) + (t?.veryLowPct ?? 100));
    expect(t?.inRangePct).toBeLessThan(75);
  });

  it("names a high window that crosses midnight and covers 01:00, and a low window in the evening that does not", () => {
    const high = result.patterns.filter((p) => p.kind === "high");
    const low = result.patterns.filter((p) => p.kind === "low");
    expect(high.some((p) => covers(p, 60) && p.startMinute > p.endMinute)).toBe(true);
    expect(low.some((p) => covers(p, 19 * 60 + 30))).toBe(true);
    expect(low.some((p) => covers(p, 2 * 60))).toBe(false);
  });

  it("reports the headline numbers", () => {
    expect(result.metrics.meanMmolL).toBeGreaterThan(8);
    expect(result.metrics.cvPct).toBeGreaterThan(20);
    expect(result.metrics.gmiPct).toBeGreaterThan(6);
    expect(result.configVersion).toBe(1);
  });

  it("keeps the lower percentile at or below the upper one in every bin", () => {
    for (const b of result.bins) {
      expect(b.lower).not.toBeNull();
      expect((b.lower as number) <= (b.upper as number)).toBe(true);
    }
  });
});

describe("not enough data", () => {
  it("three days is a partial picture: numbers shown, no profile patterns, no GMI", () => {
    const r = computeAgp(fortnight({ days: 3 }), NOW);
    expect(r.sufficient).toBe(false);
    expect(r.patterns).toEqual([]);
    expect(r.metrics.gmiPct).toBeNull();
    expect(r.metrics.count).toBeGreaterThan(0);
    expect(r.metrics.tir).not.toBeNull();
  });

  it("a fortnight with most readings missing is not enough either", () => {
    const r = computeAgp(fortnight({ drop: 0.8 }), NOW);
    expect(r.metrics.activePct).toBeLessThan(70);
    expect(r.sufficient).toBe(false);
  });

  it("no readings gives an empty, insufficient result without throwing", () => {
    const r = computeAgp([], NOW);
    expect(r.sufficient).toBe(false);
    expect(r.metrics.count).toBe(0);
    expect(r.metrics.tir).toBeNull();
    expect(r.metrics.meanMmolL).toBeNull();
  });
});

describe("input hygiene", () => {
  it("ignores readings outside the window, in the future, repeated, non-positive or with a bad timestamp", () => {
    const good = { takenAt: iso(NOW - DAY), mmolL: 6 };
    const r = computeAgp(
      [
        good,
        good,
        { takenAt: iso(NOW - 15 * DAY), mmolL: 6 },
        { takenAt: iso(NOW + MIN), mmolL: 6 },
        { takenAt: iso(NOW - 2 * DAY), mmolL: 0 },
        { takenAt: iso(NOW - 3 * DAY), mmolL: Number.NaN },
        { takenAt: "not a date", mmolL: 6 },
      ],
      NOW,
    );
    expect(r.metrics.count).toBe(1);
  });

  it("bins by Lagos time: 23:30 UTC is 00:30 the next local day", () => {
    const r = computeAgp([{ takenAt: "2026-10-20T23:30:00.000Z", mmolL: 6 }], NOW);
    expect(r.bins[1]?.startMinute).toBe(30);
    expect(r.bins[1]?.n).toBe(1);
    expect(r.bins[47]?.n).toBe(0);
  });

  it("classifies in whole mg/dL against 54, 70, 180 and 250, whatever unit the person reads", () => {
    const band = (mg: number) => computeAgp([{ takenAt: iso(NOW - DAY), mmolL: mgDlToMmolL(mg) }], NOW).metrics.tir;
    expect(band(180)?.inRangePct).toBe(100);
    expect(band(181)?.highPct).toBe(100);
    expect(band(70)?.inRangePct).toBe(100);
    expect(band(69)?.lowPct).toBe(100);
    expect(band(54)?.lowPct).toBe(100);
    expect(band(53)?.veryLowPct).toBe(100);
    expect(band(250)?.highPct).toBe(100);
    expect(band(251)?.veryHighPct).toBe(100);
  });

  it("classifies a mmol/L sensor's tenths the same way: 3.9 and 10.0 are in range, 3.8 low, 10.1 high, 2.9 very low, 14.0 very high", () => {
    const one = (v: number) => computeAgp([{ takenAt: iso(NOW - DAY), mmolL: v }], NOW).metrics.tir;
    expect(one(3.9)?.inRangePct).toBe(100);
    expect(one(10.0)?.inRangePct).toBe(100);
    expect(one(3.8)?.lowPct).toBe(100);
    expect(one(10.1)?.highPct).toBe(100);
    expect(one(3.0)?.lowPct).toBe(100);
    expect(one(2.9)?.veryLowPct).toBe(100);
    expect(one(13.9)?.highPct).toBe(100);
    expect(one(14.0)?.veryHighPct).toBe(100);
  });

  it("counts a sensor that reaches us by two routes a few seconds apart once, and keeps readings five minutes apart", () => {
    const base = fortnight();
    const doubled = base.flatMap((x) => [x, { takenAt: iso(Date.parse(x.takenAt) + 20_000), mmolL: x.mmolL }]);
    expect(computeAgp(doubled, NOW).metrics.count).toBe(computeAgp(base, NOW).metrics.count);
    expect(computeAgp(base, NOW).metrics.count).toBeGreaterThan(4000);
  });

  it("takes the time zone from the configuration, not from the code", () => {
    const loaded = loadAgpConfig();
    const utc = { ...loaded, config: { ...loaded.config, timezone: "UTC" } };
    const sample = [{ takenAt: "2026-10-20T23:30:00.000Z", mmolL: 6 }];
    expect(computeAgp(sample, NOW, utc).bins[47]?.n).toBe(1);
    expect(computeAgp(sample, NOW).bins[1]?.n).toBe(1);
  });
});

describe("a small but real share is never shown as nothing", () => {
  it("twelve very low readings in four thousand still show, as under one percent and at least one point", () => {
    const samples = fortnight({ everyMin: 5 }).map((x) => ({ ...x, mmolL: 8 }));
    for (let i = 0; i < 12; i++) samples[i * 300] = { ...(samples[i * 300] as { takenAt: string }), mmolL: 2.5 };
    const m = computeAgp(samples, NOW).metrics;
    expect(m.tir?.veryLowPct).toBeGreaterThanOrEqual(1);
    expect(m.tirExactPct?.veryLowPct).toBeLessThan(1);
    expect(m.tirExactPct?.veryLowPct).toBeGreaterThan(0);
    const t = m.tir as Record<string, number>;
    expect(Object.values(t).reduce((s, n) => s + n, 0)).toBe(100);
  });

  it("roundShares gives a non-zero count at least one point and still adds to 100", () => {
    const r = roundShares([1, 0, 9999]);
    expect(r[0]).toBeGreaterThanOrEqual(1);
    expect(r[1]).toBe(0);
    expect(r.reduce((s, n) => s + n, 0)).toBe(100);
  });
});

describe("why the profile is not drawn", () => {
  it("names too few days when the days are short, too little coverage when the days are there but the sensor was off, and nothing when it is fine", () => {
    expect(computeAgp(fortnight({ days: 3 }), NOW).insufficientReason).toBe("days");
    expect(computeAgp(fortnight({ drop: 0.85 }), NOW).insufficientReason).toBe("coverage");
    expect(computeAgp(fortnight(), NOW).insufficientReason).toBeNull();
    expect(computeAgp([], NOW).insufficientReason).toBeNull();
  });
});

describe("the headline formulas", () => {
  const flat = computeAgp(fortnight({ everyMin: 15 }).map((s) => ({ ...s, mmolL: 8 })), NOW);

  it("a flat 8.0 mmol/L fortnight has no spread and the published GMI", () => {
    expect(flat.metrics.sdMmolL).toBe(0);
    expect(flat.metrics.cvPct).toBe(0);
    expect(flat.metrics.gmiPct).toBeCloseTo(3.31 + 0.02392 * 8 * GLUCOSE_MMOL_TO_MGDL, 5);
    expect(flat.metrics.tir?.inRangePct).toBe(100);
    expect(flat.patterns).toEqual([]);
  });
});

describe("findPatterns", () => {
  const { config } = loadAgpConfig();
  const bin = (i: number, shareHigh: number, n = 100) => ({
    startMinute: i * config.bin_minutes,
    n,
    nLow: 0,
    nHigh: Math.round(shareHigh * n),
    lower: 5,
    upper: 9,
    mean: 7,
    shareLow: 0,
    shareHigh,
  });
  const day = (flag: (i: number) => boolean, n = 100) => Array.from({ length: 48 }, (_, i) => bin(i, flag(i) ? 0.8 : 0.1, n));

  it("joins a run across midnight into one window", () => {
    const [p] = findPatterns(day((i) => i >= 44 || i < 6), config);
    expect(p).toMatchObject({ kind: "high", startMinute: 22 * 60, endMinute: 3 * 60, peakSharePct: 80 });
  });

  it("ignores a run shorter than the minimum length", () => {
    expect(findPatterns(day((i) => i === 20 || i === 21), config)).toEqual([]);
  });

  it("ignores bins with too few readings", () => {
    expect(findPatterns(day((i) => i < 8, config.min_readings_per_bin - 1), config)).toEqual([]);
  });

  it("counts a bin exactly at the threshold (57 of 100 at 57 percent), which a float ratio would miss", () => {
    expect(0.57 * 100).toBeLessThan(57);
    const cfg = { ...config, pattern: { ...config.pattern, high_share_pct: 57 } };
    const bins = Array.from({ length: 48 }, (_, i) => ({ ...bin(i, i < 8 ? 0.57 : 0.1), nHigh: i < 8 ? 57 : 10 }));
    expect(findPatterns(bins, cfg)).toEqual([expect.objectContaining({ kind: "high", startMinute: 0, endMinute: 240 })]);
  });

  it("a whole day above range is one window, not a crash", () => {
    const r = findPatterns(day(() => true), config);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ startMinute: 0, endMinute: 0 });
  });
});

describe("clockLabel", () => {
  it("formats minutes after midnight", () => {
    expect(clockLabel(0)).toBe("00:00");
    expect(clockLabel(1110)).toBe("18:30");
    expect(clockLabel(1440)).toBe("00:00");
  });
});
