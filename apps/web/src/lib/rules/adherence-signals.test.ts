import { describe, expect, it } from "@jest/globals";
import { computeRefillGapSignal } from "./adherence-signals";

describe("computeRefillGapSignal", () => {
  it("flags the spec's own example: 30-day supply, 37-day actual gap", () => {
    const signal = computeRefillGapSignal("med-1", 30, ["2026-01-01", "2026-02-07"]);
    expect(signal).not.toBeNull();
    expect(signal!.expectedIntervalDays).toBe(30);
    expect(signal!.actualIntervalDays).toBe(37);
    expect(signal!.gapDays).toBe(7);
  });

  it("returns null when there is no known day-supply", () => {
    expect(computeRefillGapSignal("med-1", null, ["2026-01-01", "2026-02-07"])).toBeNull();
    expect(computeRefillGapSignal("med-1", undefined, ["2026-01-01", "2026-02-07"])).toBeNull();
  });

  it("returns null with fewer than two collections", () => {
    expect(computeRefillGapSignal("med-1", 30, [])).toBeNull();
    expect(computeRefillGapSignal("med-1", 30, ["2026-01-01"])).toBeNull();
  });

  it("returns null when the actual interval matches the expected one", () => {
    expect(computeRefillGapSignal("med-1", 30, ["2026-01-01", "2026-01-31"])).toBeNull();
  });

  it("returns null for a small, ordinary-noise gap (under the 5-day threshold)", () => {
    expect(computeRefillGapSignal("med-1", 30, ["2026-01-01", "2026-02-03"])).toBeNull(); // 33 days, 3-day gap
  });

  it("flags a gap right at the 5-day threshold", () => {
    const signal = computeRefillGapSignal("med-1", 30, ["2026-01-01", "2026-02-05"]); // 35 days, 5-day gap
    expect(signal).not.toBeNull();
    expect(signal!.gapDays).toBe(5);
  });

  it("returns null when the patient collected EARLY (negative gap)", () => {
    expect(computeRefillGapSignal("med-1", 30, ["2026-01-01", "2026-01-20"])).toBeNull();
  });

  it("only compares the two most recent collections, ignoring order of input", () => {
    const signal = computeRefillGapSignal("med-1", 30, [
      "2026-04-10", // most recent — 69 days after the Jan 31 pickup, a real gap
      "2026-01-01",
      "2026-01-31", // second most recent
    ]);
    expect(signal).not.toBeNull();
    expect(signal!.fromDate).toBe("2026-01-31");
    expect(signal!.toDate).toBe("2026-04-10");
  });
});
