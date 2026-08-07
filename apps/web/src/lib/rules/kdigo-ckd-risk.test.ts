import { describe, it, expect } from "@jest/globals";
import { combineKdigoRisk, acrCategory } from "./kdigo-ckd-risk";

describe("acrCategory", () => {
  it("bands per KDIGO cutoffs", () => {
    expect(acrCategory(10)).toBe("A1");
    expect(acrCategory(29.9)).toBe("A1");
    expect(acrCategory(30)).toBe("A2");
    expect(acrCategory(300)).toBe("A2");
    expect(acrCategory(300.1)).toBe("A3");
    expect(acrCategory(1000)).toBe("A3");
  });
});

describe("combineKdigoRisk", () => {
  it("returns null for a non-finite or negative ACR", () => {
    expect(combineKdigoRisk({ gfrCategory: "G1", acrMgG: Number.NaN })).toBeNull();
    expect(combineKdigoRisk({ gfrCategory: "G1", acrMgG: -1 })).toBeNull();
  });

  it("normal GFR + normal ACR is low risk", () => {
    const r = combineKdigoRisk({ gfrCategory: "G1", acrMgG: 10 })!;
    expect(r.riskLevel).toBe("low");
    expect(r.acrCategory).toBe("A1");
    expect(r.invisibleToEgfrAlone).toBe(false);
  });

  it("the case eGFR alone misses: normal GFR + severely increased ACR is high risk", () => {
    const r = combineKdigoRisk({ gfrCategory: "G2", acrMgG: 400 })!;
    expect(r.riskLevel).toBe("high");
    expect(r.acrCategory).toBe("A3");
    expect(r.invisibleToEgfrAlone).toBe(true);
  });

  it("moderately reduced GFR + normal ACR is only moderate risk (G3a x A1)", () => {
    const r = combineKdigoRisk({ gfrCategory: "G3a", acrMgG: 10 })!;
    expect(r.riskLevel).toBe("moderate");
  });

  it("G3a + A2 escalates to high, matching the published grid", () => {
    const r = combineKdigoRisk({ gfrCategory: "G3a", acrMgG: 100 })!;
    expect(r.riskLevel).toBe("high");
  });

  it("severely reduced GFR is very high risk regardless of ACR", () => {
    expect(combineKdigoRisk({ gfrCategory: "G4", acrMgG: 5 })!.riskLevel).toBe("very_high");
    expect(combineKdigoRisk({ gfrCategory: "G5", acrMgG: 5 })!.riskLevel).toBe("very_high");
  });

  it("risk is monotonic across each GFR row as ACR worsens", () => {
    const rank = { low: 0, moderate: 1, high: 2, very_high: 3 };
    (["G1", "G2", "G3a", "G3b", "G4", "G5"] as const).forEach((gfr) => {
      const a1 = combineKdigoRisk({ gfrCategory: gfr, acrMgG: 10 })!.riskLevel;
      const a2 = combineKdigoRisk({ gfrCategory: gfr, acrMgG: 100 })!.riskLevel;
      const a3 = combineKdigoRisk({ gfrCategory: gfr, acrMgG: 500 })!.riskLevel;
      expect(rank[a2]).toBeGreaterThanOrEqual(rank[a1]);
      expect(rank[a3]).toBeGreaterThanOrEqual(rank[a2]);
    });
  });
});
