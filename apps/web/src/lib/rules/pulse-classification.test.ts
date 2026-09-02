import { classifyPulseLevel } from "./pulse-classification";

describe("classifyPulseLevel (must match private.classify_pulse_level)", () => {
  it("EMERGENCY at or beyond 35 bpm / 150 bpm", () => {
    expect(classifyPulseLevel(35)).toBe("emergency");
    expect(classifyPulseLevel(30)).toBe("emergency");
    expect(classifyPulseLevel(150)).toBe("emergency");
    expect(classifyPulseLevel(180)).toBe("emergency");
  });

  it("RED band 36-39 / 121-149", () => {
    expect(classifyPulseLevel(36)).toBe("red");
    expect(classifyPulseLevel(39)).toBe("red");
    expect(classifyPulseLevel(121)).toBe("red");
    expect(classifyPulseLevel(149)).toBe("red");
  });

  it("AMBER band 40-49 / 101-120", () => {
    expect(classifyPulseLevel(40)).toBe("amber");
    expect(classifyPulseLevel(49)).toBe("amber");
    expect(classifyPulseLevel(101)).toBe("amber");
    expect(classifyPulseLevel(120)).toBe("amber");
  });

  it("GREEN in the 50-100 range", () => {
    expect(classifyPulseLevel(50)).toBe("green");
    expect(classifyPulseLevel(72)).toBe("green");
    expect(classifyPulseLevel(100)).toBe("green");
  });

  it("returns unknown on missing value", () => {
    expect(classifyPulseLevel(null)).toBe("unknown");
    expect(classifyPulseLevel(undefined)).toBe("unknown");
  });
});
