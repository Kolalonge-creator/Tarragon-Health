import type { BiomarkerBands } from "@tarragon/shared";
import { activeBiomarkerBands, gradeResult, isCriticalFlag, rangeBarModel } from "./grade";

const bands: BiomarkerBands = {
  analytes: {
    total_cholesterol: { unit: "mmol/L", good: { min: null, max: 5.0 }, acceptable: { min: null, max: 6.4 } },
    hdl_cholesterol: { unit: "mmol/L", good: { min: 1.0, max: null }, acceptable: { min: 0.8, max: null } },
    creatinine_test: { unit: "µmol/L", good: { min: 50, max: 100 }, acceptable: { min: 40, max: 120 } },
  },
};
const pt = (value: number, o: Partial<{ unit: string | null; flag: string | null; refLow: number | null; refHigh: number | null }> = {}) => ({
  value,
  unit: "mmol/L",
  flag: null,
  refLow: null,
  refHigh: null,
  ...o,
});

describe("activeBiomarkerBands", () => {
  it("is null while the CMO has not confirmed the bands (no grade ships unsigned)", () => {
    expect(activeBiomarkerBands()).toBeNull();
  });
});

describe("gradeResult", () => {
  it("grades by band", () => {
    expect(gradeResult("total_cholesterol", pt(4.2), bands)).toBe("good");
    expect(gradeResult("total_cholesterol", pt(5.02), bands)).toBe("acceptable");
    expect(gradeResult("total_cholesterol", pt(7.1), bands)).toBe("needs_attention");
    expect(gradeResult("hdl_cholesterol", pt(0.6), bands)).toBe("needs_attention");
  });
  it("returns null with no band, no bands at all, or a different unit (never converts)", () => {
    expect(gradeResult("sodium", pt(140), bands)).toBeNull();
    expect(gradeResult("total_cholesterol", pt(4.2), null)).toBeNull();
    expect(gradeResult("total_cholesterol", pt(190, { unit: "mg/dL" }), bands)).toBeNull();
    expect(gradeResult("total_cholesterol", pt(4.2, { unit: null }), bands)).toBeNull();
  });
  it("treats µ and u spellings of a unit as the same unit", () => {
    expect(gradeResult("creatinine_test", pt(80, { unit: "umol/L" }), bands)).toBe("good");
  });
  it("lets the lab flag make a grade worse but never better", () => {
    expect(gradeResult("total_cholesterol", pt(4.2, { flag: "high" }), bands)).toBe("acceptable");
    expect(gradeResult("total_cholesterol", pt(4.2, { refHigh: 4.0 }), bands)).toBe("acceptable");
    expect(gradeResult("total_cholesterol", pt(4.2, { flag: "critical_high" }), bands)).toBe("needs_attention");
    expect(gradeResult("total_cholesterol", pt(7.1, { flag: "normal", refHigh: 9 }), bands)).toBe("needs_attention");
  });
});

describe("critical flags and units", () => {
  it("treats the plain 'critical' flag the database stores as critical", () => {
    expect(isCriticalFlag("critical")).toBe(true);
    expect(isCriticalFlag("critical_low")).toBe(true);
    expect(isCriticalFlag("high")).toBe(false);
    expect(gradeResult("total_cholesterol", pt(4.2, { flag: "critical" }), bands)).toBe("needs_attention");
  });
  it("matches eGFR spelled with a superscript two", () => {
    const egfr: BiomarkerBands = { analytes: { egfr: { unit: "mL/min/1.73m2", good: { min: 90, max: null }, acceptable: { min: 60, max: null } } } };
    expect(gradeResult("egfr", pt(95, { unit: "mL/min/1.73 m²" }), egfr)).toBe("good");
  });
});

describe("rangeBarModel", () => {
  it("keeps the good and acceptable segments visible for an outlier value", () => {
    const m = rangeBarModel(20, bands.analytes.total_cholesterol);
    const good = m.segments.find((s) => s.grade === "good");
    expect(good).toBeDefined();
    expect((good?.to ?? 0) - (good?.from ?? 0)).toBeGreaterThan(5);
    expect(m.marker).toBeLessThanOrEqual(100);
  });
  const band = bands.analytes.total_cholesterol;
  it("covers 0..100 with ordered, non-overlapping segments", () => {
    const m = rangeBarModel(5.02, band);
    expect(m.segments[0].from).toBe(0);
    expect(m.segments[m.segments.length - 1].to).toBe(100);
    m.segments.slice(1).forEach((s, i) => expect(s.from).toBeCloseTo(m.segments[i].to, 5));
  });
  it("puts the marker in the segment that matches the grade and clamps it to the bar", () => {
    const m = rangeBarModel(5.02, band);
    const seg = m.segments.find((s) => m.marker >= s.from && m.marker <= s.to);
    expect(seg?.grade).toBe("acceptable");
    expect(rangeBarModel(99, band).marker).toBeLessThanOrEqual(100);
    expect(rangeBarModel(-5, band).marker).toBeGreaterThanOrEqual(0);
  });
  it("handles a band open at the top (HDL) without a fabricated upper edge", () => {
    const m = rangeBarModel(1.4, bands.analytes.hdl_cholesterol);
    expect(m.segments.map((s) => s.grade)).toEqual(["needs_attention", "acceptable", "good"]);
  });
});
