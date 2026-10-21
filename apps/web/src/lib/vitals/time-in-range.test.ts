import { mgDlToMmolL } from "@tarragon/shared";
import { computeTimeInRange, sensorReadingCount } from "./time-in-range";

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

describe("the same lines as the glucose profile", () => {
  it("judges in whole mg/dL: 181 is above the 10.0 line and 180 is not, 69 is below the 3.9 line and 70 is not", () => {
    const r = computeTimeInRange([mgDlToMmolL(181), mgDlToMmolL(180), mgDlToMmolL(69), mgDlToMmolL(70)])!;
    expect(r.above).toBe(1);
    expect(r.below).toBe(1);
    expect(r.inRange).toBe(2);
  });
});

describe("sensorReadingCount", () => {
  it("counts only cgm and wearable readings", () => {
    expect(sensorReadingCount([{ source: "cgm" }, { source: "wearable" }, { source: "manual" }, { source: "device" }, { source: null }])).toBe(2);
    expect(sensorReadingCount([])).toBe(0);
  });
});
