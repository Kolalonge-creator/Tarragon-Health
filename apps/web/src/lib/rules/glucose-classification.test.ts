import { classifyLatestGlucoseLevel } from "./glucose-classification";

describe("classifyLatestGlucoseLevel (single-reading mirror of glucose-red-flags.classifyGlucose)", () => {
  it("EMERGENCY below the severe-hypo threshold (3.0 mmol/L)", () => {
    expect(classifyLatestGlucoseLevel(2.9)).toBe("emergency");
    expect(classifyLatestGlucoseLevel(1.0)).toBe("emergency");
  });

  it("RED for the same-day hypo-alert band (3.0-3.8 mmol/L)", () => {
    expect(classifyLatestGlucoseLevel(3.0)).toBe("red");
    expect(classifyLatestGlucoseLevel(3.8)).toBe("red");
  });

  it("RED at or above the very-high threshold (20.0 mmol/L)", () => {
    expect(classifyLatestGlucoseLevel(20.0)).toBe("red");
    expect(classifyLatestGlucoseLevel(25.0)).toBe("red");
  });

  it("GREEN in the ordinary range, including a single high-but-not-acute value", () => {
    expect(classifyLatestGlucoseLevel(5.5)).toBe("green");
    // 15 mmol/L is only flagged by the real engine as part of a 3-reading
    // persistent-high pattern — a single reading correctly stays unflagged.
    expect(classifyLatestGlucoseLevel(15)).toBe("green");
  });

  it("returns unknown on missing value", () => {
    expect(classifyLatestGlucoseLevel(null)).toBe("unknown");
    expect(classifyLatestGlucoseLevel(undefined)).toBe("unknown");
  });
});
