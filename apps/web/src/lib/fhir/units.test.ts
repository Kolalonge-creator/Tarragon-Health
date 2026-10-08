import { describe, expect, it } from "@jest/globals";
import { CANONICAL_UNIT, convertToCanonical, labUnitToUcum, normaliseUnitKey } from "./units";

describe("convertToCanonical: a value is only ever read in a unit we can name", () => {
  it("keeps a value that is already in the stored unit, with no warning", () => {
    expect(convertToCanonical("glucose", 5.4, "mmol/L")).toEqual({ value: 5.4, warning: null });
    expect(convertToCanonical("weight", 72.5, "kg", "kg")).toEqual({ value: 72.5, warning: null });
    expect(convertToCanonical("temperature", 37.2, "°C", "Cel")).toEqual({ value: 37.2, warning: null });
    expect(convertToCanonical("blood_pressure", 128, "mmHg", "mm[Hg]")).toEqual({ value: 128, warning: null });
    expect(convertToCanonical("pulse", 72, "beats/min", "/min")).toEqual({ value: 72, warning: null });
  });

  it("converts glucose in mg/dL to mmol/L and says so (the old import filed 126 mg/dL as 126 mmol/L)", () => {
    const r = convertToCanonical("glucose", 126, "mg/dL");
    expect(r?.value).toBe(6.99);
    expect(r?.warning).toContain("mg/dL");
  });

  it("converts pounds, degrees F and inches", () => {
    expect(convertToCanonical("weight", 160, "[lb_av]")?.value).toBe(72.57);
    expect(convertToCanonical("temperature", 98.6, "[degF]")?.value).toBe(37);
    expect(convertToCanonical("waist_circumference", 34, "[in_i]")?.value).toBe(86.4);
  });

  it("refuses a missing unit: the number alone does not say what it means", () => {
    expect(convertToCanonical("glucose", 126, undefined)).toBeNull();
    expect(convertToCanonical("weight", 70, null, null)).toBeNull();
    expect(convertToCanonical("blood_pressure", 120, "")).toBeNull();
  });

  it("refuses a unit it does not know, or one that does not belong to the vital", () => {
    expect(convertToCanonical("glucose", 5, "kPa")).toBeNull();
    expect(convertToCanonical("weight", 5, "mmol/L")).toBeNull();
    expect(convertToCanonical("blood_pressure", 16, "kPa")).toBeNull();
    expect(convertToCanonical("spo2", 0.97, "1")).toBeNull();
  });

  it("prefers the UCUM code over the display unit when both are sent", () => {
    expect(normaliseUnitKey("something odd", "mg/dL")).toBe("mg/dL");
  });

  it("has a stored unit for every vital the export maps", () => {
    for (const v of ["blood_pressure", "pulse", "glucose", "weight", "temperature", "spo2", "waist_circumference", "respiratory_rate", "peak_flow"] as const) {
      expect(CANONICAL_UNIT[v]).toBeDefined();
    }
  });

  it("gives the lab panel units a UCUM code, and leaves an unknown unit without one", () => {
    expect(labUnitToUcum("mg/dL")).toBe("mg/dL");
    expect(labUnitToUcum("10^9/L")).toBe("10*9/L");
    expect(labUnitToUcum("mIU/L")).toBe("m[IU]/L");
    expect(labUnitToUcum("furlongs")).toBeNull();
  });
});
