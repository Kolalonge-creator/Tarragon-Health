import { chartGeometry, displayCode, groupByUnit, labRangeLabel, parseTrend, positionInLabRange, targetLabel, type TrendPoint } from "./trend";

const pt = (over: Partial<TrendPoint> = {}): TrendPoint => ({
  takenAt: "2025-01-01T00:00:00Z",
  value: 6,
  unit: "%",
  refLow: 4,
  refHigh: 5.6,
  refText: null,
  flag: null,
  source: "lab_result",
  laboratory: null,
  ...over,
});

describe("parseTrend", () => {
  it("reads the series, oldest first, with the lab's own range on each point", () => {
    const s = parseTrend({
      code: "hba1c",
      unit_mixed: false,
      target: null,
      points: [
        { taken_at: "2025-06-01T00:00:00Z", value: 6.9, unit: "%", ref_low: "4.0000", ref_high: "5.6000", ref_text: null, flag: "high", source: "lab_result", laboratory: null },
        { taken_at: "2023-06-01T00:00:00Z", value: "6.1", unit: "%", ref_low: 4, ref_high: 5.6, ref_text: null, flag: "high", source: "legacy_report", laboratory: "Lab A" },
      ],
    });
    expect(s?.points.map((p) => p.value)).toEqual([6.1, 6.9]);
    expect(s?.points[1]).toMatchObject({ refLow: 4, refHigh: 5.6 });
  });

  it("drops a point with no numeric value or a bad date, never repairs it", () => {
    const s = parseTrend({ code: "x", points: [{ taken_at: "nope", value: 1 }, { taken_at: "2025-01-01T00:00:00Z", value: null }, { taken_at: "2025-01-01T00:00:00Z", value: 2 }] });
    expect(s?.points).toHaveLength(1);
  });

  it("only a care team target is ever carried as a target", () => {
    expect(parseTrend({ code: "x", points: [], target: { min: null, max: 7, condition: "diabetes", set_by: "care_team" } })?.target).toEqual({ min: null, max: 7, condition: "diabetes" });
    expect(parseTrend({ code: "x", points: [], target: { min: null, max: 7, set_by: "tarragon" } })?.target).toBeNull();
    expect(parseTrend({ code: "x", points: [], target: { max: 7 } })?.target).toBeNull();
    expect(parseTrend({ code: "x", points: [], target: { set_by: "care_team" } })?.target).toBeNull();
  });

  it("is null for something that is not an object", () => {
    expect(parseTrend(null)).toBeNull();
    expect(parseTrend("x")).toBeNull();
  });
});

describe("groupByUnit", () => {
  it("never joins different units and never converts", () => {
    const g = groupByUnit([pt({ unit: "%", value: 6 }), pt({ unit: "mmol/mol", value: 52 }), pt({ unit: "%", value: 7 })]);
    expect(g.map((x) => [x.unit, x.points.map((p) => p.value)])).toEqual([["%", [6, 7]], ["mmol/mol", [52]]]);
  });
  it("treats unit case and spacing as the same unit", () => {
    expect(groupByUnit([pt({ unit: "mmol/L" }), pt({ unit: " MMOL/L " })])).toHaveLength(1);
  });
});

describe("labRangeLabel", () => {
  it("uses the lab's own text when it sent one", () => {
    expect(labRangeLabel(pt({ refText: "< 5.7" }))).toBe("< 5.7");
  });
  it("describes numeric bounds, and says nothing when the lab sent none", () => {
    expect(labRangeLabel(pt())).toBe("4 to 5.6");
    expect(labRangeLabel(pt({ refLow: null }))).toBe("up to 5.6");
    expect(labRangeLabel(pt({ refHigh: null }))).toBe("4 or more");
    expect(labRangeLabel(pt({ refLow: null, refHigh: null }))).toBeNull();
  });
});

describe("positionInLabRange", () => {
  it("compares only against the lab's range", () => {
    expect(positionInLabRange({ value: 5, refLow: 4, refHigh: 5.6 })).toBe("within");
    expect(positionInLabRange({ value: 3, refLow: 4, refHigh: 5.6 })).toBe("below");
    expect(positionInLabRange({ value: 6, refLow: 4, refHigh: 5.6 })).toBe("above");
    expect(positionInLabRange({ value: 6, refLow: null, refHigh: null })).toBe("unknown");
    expect(positionInLabRange({ value: 6, refLow: null, refHigh: 5.6 })).toBe("above");
  });
});

describe("targetLabel", () => {
  it("words a target without inventing bounds", () => {
    expect(targetLabel({ min: null, max: 7, condition: null })).toBe("7 or less");
    expect(targetLabel({ min: 3, max: null, condition: null })).toBe("3 or more");
    expect(targetLabel({ min: 3, max: 7, condition: null })).toBe("3 to 7");
  });
});

describe("displayCode", () => {
  it("keeps the usual casing of short lab names and humanises the rest", () => {
    expect(displayCode("hba1c")).toBe("HbA1c");
    expect(displayCode("ldl")).toBe("LDL");
    expect(displayCode("egfr")).toBe("eGFR");
    expect(displayCode("fasting_glucose")).toBe("Fasting glucose");
  });
});

describe("chartGeometry", () => {
  const series = [
    pt({ takenAt: "2023-01-01T00:00:00Z", value: 6.1 }),
    pt({ takenAt: "2024-01-01T00:00:00Z", value: 6.9 }),
    pt({ takenAt: "2025-01-01T00:00:00Z", value: 5.8 }),
  ];

  it("is null with no points", () => {
    expect(chartGeometry([], null)).toBeNull();
  });

  it("draws the lab's band only when every point shares one range", () => {
    expect(chartGeometry(series, null)?.band).not.toBeNull();
    const changed = [...series.slice(0, 2), pt({ takenAt: "2025-01-01T00:00:00Z", value: 5.8, refLow: 20, refHigh: 38 })];
    expect(chartGeometry(changed, null)?.band).toBeNull();
  });

  it("draws no band at all when the lab sent no numeric range (nothing invented)", () => {
    const none = series.map((p) => ({ ...p, refLow: null, refHigh: null }));
    expect(chartGeometry(none, null)?.band).toBeNull();
  });

  it("draws a target band only when a target is passed", () => {
    expect(chartGeometry(series, null)?.targetBand).toBeNull();
    expect(chartGeometry(series, { min: null, max: 7, condition: null })?.targetBand).not.toBeNull();
  });

  it("spaces points by time, keeps them inside the box, and handles a single point and equal values", () => {
    const g = chartGeometry(series, null, 320, 160)!;
    expect(g.dots[0].x).toBeLessThan(g.dots[1].x);
    expect(g.dots[1].x).toBeLessThan(g.dots[2].x);
    for (const d of g.dots) {
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThanOrEqual(320);
      expect(d.y).toBeGreaterThanOrEqual(0);
      expect(d.y).toBeLessThanOrEqual(160);
    }
    const one = chartGeometry([pt()], null)!;
    expect(one.dots).toHaveLength(1);
    expect(Number.isFinite(one.dots[0].y)).toBe(true);
    const flat = chartGeometry([pt({ value: 5, takenAt: "2024-01-01T00:00:00Z" }), pt({ value: 5, takenAt: "2025-01-01T00:00:00Z" })], null)!;
    expect(flat.path).toMatch(/^M/);
  });

  it("a higher value is drawn higher on the page", () => {
    const g = chartGeometry(series, null)!;
    expect(g.dots[1].y).toBeLessThan(g.dots[0].y);
  });
});
