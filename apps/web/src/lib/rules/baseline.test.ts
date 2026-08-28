import { compareToBaseline } from "./baseline";

describe("compareToBaseline", () => {
  it("improving: BP falls from a high baseline (higher-is-worse metric)", () => {
    const result = compareToBaseline("blood_pressure_systolic", 155, 138);
    expect(result.change).toBe("improving");
    expect(result.percentChange).toBeLessThan(0);
  });

  it("worsening: BP rises from baseline", () => {
    const result = compareToBaseline("blood_pressure_systolic", 130, 150);
    expect(result.change).toBe("worsening");
    expect(result.percentChange).toBeGreaterThan(0);
  });

  it("improving: spo2 rises from baseline (lower-is-worse metric)", () => {
    const result = compareToBaseline("spo2", 90, 96);
    expect(result.change).toBe("improving");
  });

  it("worsening: spo2 falls from baseline", () => {
    const result = compareToBaseline("spo2", 97, 91);
    expect(result.change).toBe("worsening");
  });

  it("unchanged: movement within the noise band", () => {
    const result = compareToBaseline("weight", 80, 81);
    expect(result.change).toBe("unchanged");
  });
});
