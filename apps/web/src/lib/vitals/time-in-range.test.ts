import { computeTimeInRange } from "./time-in-range";

describe("computeTimeInRange", () => {
  it("returns null for no readings", () => {
    expect(computeTimeInRange([])).toBeNull();
  });

  it("splits readings into below / in-range / above", () => {
    const r = computeTimeInRange([3.0, 5, 6, 7, 12])!;
    expect(r.total).toBe(5);
    expect(r.below).toBe(1); // 3.0 < 3.9
    expect(r.inRange).toBe(3); // 5, 6, 7
    expect(r.above).toBe(1); // 12 > 10
    expect(r.inRangePct).toBe(60);
  });

  it("honours a custom (relaxed) range", () => {
    const r = computeTimeInRange([11, 12, 6], { high: 13 })!;
    expect(r.above).toBe(0);
    expect(r.inRange).toBe(3);
  });

  it("treats the boundaries as in-range", () => {
    const r = computeTimeInRange([3.9, 10.0])!;
    expect(r.inRange).toBe(2);
  });
});
