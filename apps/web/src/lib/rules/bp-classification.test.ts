import { classifyBpLevel } from "./bp-classification";

describe("classifyBpLevel (must match private.classify_bp_level)", () => {
  it("flags hypertensive crisis by diastolic >= 120", () => {
    expect(classifyBpLevel(190, 125)).toBe("emergency");
    expect(classifyBpLevel(175, 122)).toBe("emergency");
  });

  it("flags isolated severe systolic >= 200 as emergency", () => {
    expect(classifyBpLevel(205, 98)).toBe("emergency");
  });

  it("severe systolic 180-199 with diastolic < 120 is RED (urgency), not emergency", () => {
    expect(classifyBpLevel(185, 95)).toBe("red");
    expect(classifyBpLevel(180, 100)).toBe("red");
  });

  it("RED band 160-199 / 100-119", () => {
    expect(classifyBpLevel(168, 104)).toBe("red");
    expect(classifyBpLevel(160, 84)).toBe("red");
    expect(classifyBpLevel(120, 100)).toBe("red");
  });

  it("AMBER band 135-159 / 85-99", () => {
    expect(classifyBpLevel(148, 92)).toBe("amber");
    expect(classifyBpLevel(135, 70)).toBe("amber");
    expect(classifyBpLevel(120, 85)).toBe("amber");
  });

  it("GREEN below 135/85", () => {
    expect(classifyBpLevel(122, 78)).toBe("green");
    expect(classifyBpLevel(134, 84)).toBe("green");
  });

  it("higher-category rule: whichever of systolic/diastolic is worse wins", () => {
    expect(classifyBpLevel(134, 105)).toBe("red"); // diastolic drives
    expect(classifyBpLevel(162, 70)).toBe("red"); // systolic drives
  });

  it("returns unknown on missing components", () => {
    expect(classifyBpLevel(null, 90)).toBe("unknown");
    expect(classifyBpLevel(120, undefined)).toBe("unknown");
  });
});
