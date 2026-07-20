import { estimateCvdRiskBand } from "./cvd-risk-afro";

describe("estimateCvdRiskBand (WHO/ISH AFRO-style estimate)", () => {
  it("returns insufficient when key inputs are missing", () => {
    expect(estimateCvdRiskBand({ age: null, sex: "male", smoker: false, diabetic: false, systolic: 130 }).band).toBe("insufficient");
    expect(estimateCvdRiskBand({ age: 50, sex: null, smoker: false, diabetic: false, systolic: 130 }).band).toBe("insufficient");
  });

  it("young non-smoker, normal BP -> low", () => {
    expect(estimateCvdRiskBand({ age: 35, sex: "female", smoker: false, diabetic: false, systolic: 118 }).band).toBe("low");
  });

  it("older diabetic smoker with severe BP -> very high", () => {
    expect(
      estimateCvdRiskBand({ age: 72, sex: "male", smoker: true, diabetic: true, systolic: 185, totalCholesterolMmol: 8.2 }).band
    ).toBe("very_high");
  });

  it("cholesterol is optional (lab-free estimate still returns a band)", () => {
    const r = estimateCvdRiskBand({ age: 62, sex: "male", smoker: true, diabetic: false, systolic: 165 });
    expect(r.labUsed).toBe(false);
    expect(["moderate", "high", "very_high"]).toContain(r.band);
  });

  it("risk is monotonic in systolic BP", () => {
    const base = { age: 55, sex: "male" as const, smoker: false, diabetic: false };
    const low = estimateCvdRiskBand({ ...base, systolic: 120 }).points;
    const high = estimateCvdRiskBand({ ...base, systolic: 185 }).points;
    expect(high).toBeGreaterThan(low);
  });
});
