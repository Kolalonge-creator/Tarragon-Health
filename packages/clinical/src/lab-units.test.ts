import { acceptedUnits, fromCanonicalUnit, LAB_UNIT_CONVERSIONS, normaliseUnitLabel, toCanonicalUnit } from "./lab-units";
import { classifyLabResult, effectiveRange, LabEntryError, type LabPanelDefinition } from "./lab-release";

describe("normaliseUnitLabel", () => {
  it("reads every common spelling as one label", () => {
    expect(normaliseUnitLabel(" µmol/L ")).toBe("umol/l");
    expect(normaliseUnitLabel("μmol/L")).toBe("umol/l");
    expect(normaliseUnitLabel("umol/L")).toBe("umol/l");
    expect(normaliseUnitLabel("x10^9/L")).toBe("10^9/l");
    expect(normaliseUnitLabel("10*9/L")).toBe("10^9/l");
    expect(normaliseUnitLabel("10E9/L")).toBe("10^9/l");
    expect(normaliseUnitLabel("10⁹/L")).toBe("10^9/l");
    expect(normaliseUnitLabel("10³/µL")).toBe("10^3/ul");
    expect(normaliseUnitLabel("K/uL")).toBe("k/ul");
  });
});

describe("toCanonicalUnit", () => {
  it("leaves a value in the canonical unit alone, and treats a missing unit as canonical", () => {
    expect(toCanonicalUnit("fasting_glucose", 95, "mg/dL")).toMatchObject({ value: 95, unit: "mg/dL", converted: false, enteredUnit: "mg/dL" });
    expect(toCanonicalUnit("fasting_glucose", 95, "MG/DL").converted).toBe(false);
    expect(toCanonicalUnit("fasting_glucose", 95, undefined)).toMatchObject({ value: 95, unit: "mg/dL", converted: false, enteredUnit: null });
    expect(toCanonicalUnit("fasting_glucose", 95, "   ")).toMatchObject({ converted: false, enteredUnit: null });
    expect(toCanonicalUnit("fasting_glucose", 95, null).enteredUnit).toBeNull();
  });

  it("converts glucose in mmol/L, rounding to whole mg/dL like a lab does", () => {
    expect(toCanonicalUnit("fasting_glucose", 5.5, "mmol/L")).toMatchObject({ value: 99, converted: true, enteredValue: 5.5, enteredUnit: "mmol/L" });
    expect(toCanonicalUnit("fasting_glucose", 7, "mmol/L").value).toBe(126);
    expect(toCanonicalUnit("fasting_glucose", 2.5, "mmol/L").value).toBe(45);
  });

  it("converts creatinine from µmol/L, HbA1c from mmol/mol, lipids and haemoglobin", () => {
    expect(toCanonicalUnit("creatinine", 88.4, "µmol/L").value).toBe(1);
    expect(toCanonicalUnit("creatinine", 106, "umol/L").value).toBe(1.2);
    expect(toCanonicalUnit("hba1c", 48, "mmol/mol").value).toBe(6.5);
    expect(toCanonicalUnit("hba1c", 39, "mmol/mol").value).toBe(5.7);
    expect(toCanonicalUnit("total_cholesterol", 5.2, "mmol/L").value).toBe(201);
    expect(toCanonicalUnit("ldl_cholesterol", 3.4, "mmol/L").value).toBe(131);
    expect(toCanonicalUnit("hdl_cholesterol", 1.0, "mmol/L").value).toBe(39);
    expect(toCanonicalUnit("triglycerides", 1.7, "mmol/L").value).toBe(151);
    expect(toCanonicalUnit("haemoglobin", 130, "g/L").value).toBe(13);
  });

  it("accepts mEq/L for sodium and potassium and the other count and enzyme spellings", () => {
    expect(toCanonicalUnit("potassium", 4.1, "mEq/L")).toMatchObject({ value: 4.1, converted: true });
    expect(toCanonicalUnit("sodium", 140, "mEq/L").value).toBe(140);
    expect(toCanonicalUnit("wbc", 6.2, "10^3/µL").value).toBe(6.2);
    expect(toCanonicalUnit("wbc", 6200, "cells/µL").value).toBe(6.2);
    expect(toCanonicalUnit("wbc", 6200, "/uL").value).toBe(6.2);
    expect(toCanonicalUnit("wbc", 6.2, "K/uL").value).toBe(6.2);
    expect(toCanonicalUnit("platelets", 250000, "cells/uL").value).toBe(250);
    expect(toCanonicalUnit("platelets", 250, "x10^9/L")).toMatchObject({ converted: false });
    expect(toCanonicalUnit("alt", 30, "IU/L").value).toBe(30);
    expect(toCanonicalUnit("ast", 0.5, "µkat/L").value).toBe(30);
    expect(toCanonicalUnit("tsh", 2.5, "µIU/mL").value).toBe(2.5);
    expect(toCanonicalUnit("tsh", 0.0025, "mIU/mL").value).toBe(2.5);
  });

  it("refuses an unknown unit rather than guessing, and an unknown analyte that names a unit", () => {
    expect(() => toCanonicalUnit("fasting_glucose", 5, "stones")).toThrow(LabEntryError);
    expect(() => toCanonicalUnit("fasting_glucose", 5, "stones")).toThrow(/lab_unit_mismatch/);
    expect(() => toCanonicalUnit("mystery", 5, "mg/dL")).toThrow(/lab_unknown_analyte/);
  });

  it("passes an analyte with no conversion spec and no unit through unchanged (qualitative or future analytes)", () => {
    expect(toCanonicalUnit("mystery", 5)).toEqual({ value: 5, unit: "", converted: false, enteredUnit: null, enteredValue: 5 });
  });

  it("keeps the verdict the same on either side of every conversion threshold that decides a flag", () => {
    // 99 mg/dL is the top of normal fasting glucose; 5.5 mmol/L must stay normal and 5.6 mmol/L must flag.
    expect(toCanonicalUnit("fasting_glucose", 5.5, "mmol/L").value).toBeLessThanOrEqual(99);
    expect(toCanonicalUnit("fasting_glucose", 5.6, "mmol/L").value).toBeGreaterThan(99);
    // 1.3 mg/dL = 114.9 µmol/L (creatinine ceiling for men).
    expect(toCanonicalUnit("creatinine", 114, "µmol/L").value).toBeLessThanOrEqual(1.3);
    expect(toCanonicalUnit("creatinine", 116, "µmol/L").value).toBeGreaterThan(1.3);
  });
});

describe("fromCanonicalUnit and acceptedUnits", () => {
  it("shows a stored value in another known unit and returns null for an unknown one", () => {
    expect(fromCanonicalUnit("fasting_glucose", 99, "mmol/L")).toBe(5.5);
    expect(fromCanonicalUnit("fasting_glucose", 99, "mg/dL")).toBe(99);
    expect(fromCanonicalUnit("creatinine", 1, "umol/L")).toBe(88.4);
    expect(fromCanonicalUnit("hba1c", 6.5, "mmol/mol")).toBe(48);
    expect(fromCanonicalUnit("haemoglobin", 13, "g/L")).toBe(130);
    expect(fromCanonicalUnit("fasting_glucose", 99, "stones")).toBeNull();
    expect(fromCanonicalUnit("mystery", 1, "mg/dL")).toBeNull();
  });

  it("lists the canonical unit first", () => {
    expect(acceptedUnits("fasting_glucose")).toEqual(["mg/dL", "mmol/l"]);
    expect(acceptedUnits("mystery")).toEqual([]);
    for (const code of Object.keys(LAB_UNIT_CONVERSIONS)) expect(acceptedUnits(code)[0]).toBe(LAB_UNIT_CONVERSIONS[code].canonical);
  });

  it("round trips every analyte through every alternate unit to within the printed precision", () => {
    for (const [code, spec] of Object.entries(LAB_UNIT_CONVERSIONS)) {
      for (const [unit] of Object.entries(spec.alternates)) {
        const stored = 100;
        const shown = spec.fromCanonical[unit](stored);
        const back = spec.alternates[unit](shown);
        expect(Math.abs(back - stored)).toBeLessThan(1e-9 * Math.max(1, stored));
        expect(code).toBeTruthy();
      }
    }
  });
});

const hbPanel: LabPanelDefinition = {
  analytes: [
    { code: "haemoglobin", label: "Haemoglobin", kind: "numeric", unit: "g/dL", refLow: 12, refHigh: 17.5, criticalLow: 7, criticalHigh: 20, bySex: { male: { refLow: 13, refHigh: 17.5 }, female: { refLow: 12, refHigh: 15.5 } } },
    { code: "alt", label: "ALT", kind: "numeric", unit: "U/L", refLow: 7, refHigh: 56 },
  ],
};

describe("sex-specific reference ranges", () => {
  it("judges a haemoglobin of 12.5 as normal for a woman and low for a man (WHO anaemia thresholds)", () => {
    const item = [{ analyteCode: "haemoglobin", valueNumeric: 12.5 }, { analyteCode: "alt", valueNumeric: 20 }];
    expect(classifyLabResult(hbPanel, item, "female").items[0]).toMatchObject({ flag: "normal", refLow: 12, refHigh: 15.5 });
    expect(classifyLabResult(hbPanel, item, "male").items[0]).toMatchObject({ flag: "low", refLow: 13 });
    expect(classifyLabResult(hbPanel, item, "male").releaseState).toBe("awaiting_review");
  });

  it("holds an unknown or other sex to the narrowest range so an uncertain case goes to a clinician", () => {
    const item = [{ analyteCode: "haemoglobin", valueNumeric: 12.5 }];
    for (const sex of [undefined, null, "other", "unknown"]) {
      expect(classifyLabResult(hbPanel, item, sex).items[0]).toMatchObject({ flag: "low", refLow: 13, refHigh: 15.5 });
    }
    expect(classifyLabResult(hbPanel, [{ analyteCode: "haemoglobin", valueNumeric: 16.5 }], undefined).items[0].flag).toBe("high");
  });

  it("keeps critical limits the same for everyone", () => {
    expect(classifyLabResult(hbPanel, [{ analyteCode: "haemoglobin", valueNumeric: 6.9 }], "female").items[0].flag).toBe("critical");
    expect(classifyLabResult(hbPanel, [{ analyteCode: "haemoglobin", valueNumeric: 6.9 }], "male").items[0].flag).toBe("critical");
  });

  it("leaves an analyte with no sex ranges unchanged, and falls back to the general limit for a side that is not given", () => {
    expect(effectiveRange(hbPanel.analytes[1], "female")).toEqual({ refLow: 7, refHigh: 56 });
    const def = { code: "x", label: "x", kind: "numeric" as const, unit: "u", refLow: 5, refHigh: 50, bySex: { male: { refLow: 10 } } };
    expect(effectiveRange(def, "male")).toEqual({ refLow: 10, refHigh: 50 });
    expect(effectiveRange(def, "female")).toEqual({ refLow: 5, refHigh: 50 });
    expect(effectiveRange(def, undefined)).toEqual({ refLow: 10, refHigh: 50 });
    const noGeneral = { code: "y", label: "y", kind: "numeric" as const, unit: "u", bySex: { female: { refHigh: 20 } } };
    expect(effectiveRange(noGeneral, "male")).toEqual({ refLow: undefined, refHigh: undefined });
    expect(effectiveRange(noGeneral, "female")).toEqual({ refLow: undefined, refHigh: 20 });
    expect(effectiveRange(noGeneral, null)).toEqual({ refLow: undefined, refHigh: 20 });
  });
});
