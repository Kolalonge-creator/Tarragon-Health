import { computeTimeInRange } from "./time-in-range";

describe("computeTimeInRange", () => {
  it("returns zeros for no readings", () => {
    expect(computeTimeInRange([])).toEqual({
      count: 0,
      inRangePct: 0,
      lowPct: 0,
      highPct: 0,
    });
  });

  it("ignores null glucose values", () => {
    const tir = computeTimeInRange([
      { glucose_mmol_l: null },
      { glucose_mmol_l: 6 },
    ]);
    expect(tir.count).toBe(1);
    expect(tir.inRangePct).toBe(100);
  });

  it("buckets low / in-range / high against consensus thresholds", () => {
    const tir = computeTimeInRange([
      { glucose_mmol_l: 3.0 }, // low
      { glucose_mmol_l: 5.5 }, // in range
      { glucose_mmol_l: 8.0 }, // in range
      { glucose_mmol_l: 12.0 }, // high
    ]);
    expect(tir.count).toBe(4);
    expect(tir.lowPct).toBe(25);
    expect(tir.inRangePct).toBe(50);
    expect(tir.highPct).toBe(25);
  });

  it("treats the exact boundaries (3.9 and 10.0) as in range", () => {
    const tir = computeTimeInRange([
      { glucose_mmol_l: 3.9 },
      { glucose_mmol_l: 10.0 },
    ]);
    expect(tir.inRangePct).toBe(100);
  });
});
