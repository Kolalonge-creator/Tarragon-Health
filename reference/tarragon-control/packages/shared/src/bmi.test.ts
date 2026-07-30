import { describe, expect, it } from "vitest";
import { classifyBmiBand, computeBmi } from "./bmi";

describe("computeBmi (spec §8: auto-computes BMI from height+weight)", () => {
  it("computes standard adult BMI", () => {
    // 70kg at 175cm -> 22.86
    expect(computeBmi(175, 70)).toBeCloseTo(22.857, 3);
  });

  it("computes BMI for a short/light participant", () => {
    // 45kg at 150cm -> 20.0
    expect(computeBmi(150, 45)).toBeCloseTo(20.0, 3);
  });

  it("rejects non-positive height or weight rather than silently returning Infinity/NaN", () => {
    expect(() => computeBmi(0, 70)).toThrow();
    expect(() => computeBmi(175, 0)).toThrow();
    expect(() => computeBmi(-10, 70)).toThrow();
  });
});

describe("classifyBmiBand (WHO adult bands)", () => {
  it("classifies each band correctly, including the boundaries", () => {
    expect(classifyBmiBand(17)).toBe("underweight");
    expect(classifyBmiBand(18.4)).toBe("underweight");
    expect(classifyBmiBand(18.5)).toBe("normal");
    expect(classifyBmiBand(24.9)).toBe("normal");
    expect(classifyBmiBand(25)).toBe("overweight");
    expect(classifyBmiBand(29.9)).toBe("overweight");
    expect(classifyBmiBand(30)).toBe("obese");
    expect(classifyBmiBand(40)).toBe("obese");
  });
});
