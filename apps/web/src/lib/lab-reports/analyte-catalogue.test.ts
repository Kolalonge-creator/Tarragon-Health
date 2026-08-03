import {
  convertToCanonical,
  getAnalyte,
  orientationRange,
  resolveAnalyteCode,
  ANALYTE_CATALOGUE,
} from "./analyte-catalogue";

describe("resolveAnalyteCode", () => {
  it("resolves the many names one analyte is printed under", () => {
    for (const label of ["Creatinine", "Serum Creatinine", "S. Creatinine", "CREAT", "creat"]) {
      expect(resolveAnalyteCode(label)).toBe("creatinine");
    }
  });

  it("prefers the most specific alias — the lipid-panel trap", () => {
    // If a bare "cholesterol" alias won, every HDL and LDL row on every lipid
    // panel in the country would be stored as total cholesterol.
    expect(resolveAnalyteCode("HDL Cholesterol")).toBe("hdl_cholesterol");
    expect(resolveAnalyteCode("LDL Cholesterol (calculated)")).toBe("ldl_cholesterol");
    expect(resolveAnalyteCode("Total Cholesterol")).toBe("total_cholesterol");
    expect(resolveAnalyteCode("Cholesterol")).toBe("total_cholesterol");
  });

  it("matches on whole words only, so short codes do not match inside other words", () => {
    // "k" is potassium, but must not match inside "kidney"; "cr" must not
    // match inside "creatinine clearance", which is a different measurement.
    expect(resolveAnalyteCode("Kidney Function Test")).not.toBe("potassium");
    expect(resolveAnalyteCode("K+")).toBe("potassium");
    expect(resolveAnalyteCode("Potassium")).toBe("potassium");
  });

  it("tolerates the punctuation and spacing real reports use", () => {
    expect(resolveAnalyteCode("HbA1c")).toBe("hba1c");
    expect(resolveAnalyteCode("HB A1C")).toBe("hba1c");
    expect(resolveAnalyteCode("Glycated  Haemoglobin")).toBe("hba1c");
    expect(resolveAnalyteCode("ALT (SGPT)")).toBe("alt");
    expect(resolveAnalyteCode("A.L.P.")).toBe("alp");
  });

  it("returns null for anything it does not recognise, rather than guessing", () => {
    // An unmapped row is surfaced to the reviewing clinician. Guessing the
    // nearest code would silently file a value under the wrong analyte.
    expect(resolveAnalyteCode("Blood Film Comment")).toBeNull();
    expect(resolveAnalyteCode("Appearance")).toBeNull();
    expect(resolveAnalyteCode("")).toBeNull();
  });
});

describe("convertToCanonical", () => {
  it("converts creatinine from µmol/L, the single most dangerous unit to get wrong", () => {
    // 90 µmol/L is a normal creatinine. Stored as mg/dL it would read as
    // end-stage renal failure and stop half the patient's medicines.
    const result = convertToCanonical("creatinine", 90, "µmol/L");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeCloseTo(1.018, 2);
      expect(result.converted).toBe(true);
    }
    expect(convertToCanonical("creatinine", 90, "umol/l").ok).toBe(true);
    expect(convertToCanonical("creatinine", 90, "UMOL / L").ok).toBe(true);
  });

  it("REFUSES an unrecognised unit rather than assuming it is canonical", () => {
    const result = convertToCanonical("creatinine", 90, "mg/mL");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unknown_unit");
  });

  it("accepts a missing unit as canonical but still applies the plausibility guard", () => {
    // Many reports print the unit once in a column header the extractor cannot
    // attach per row, so a blank unit has to be usable...
    const plausible = convertToCanonical("creatinine", 1.1, null);
    expect(plausible.ok).toBe(true);

    // ...but a µmol/L value arriving with no unit at all is caught here.
    const implausible = convertToCanonical("creatinine", 90, null);
    expect(implausible.ok).toBe(false);
    if (!implausible.ok) expect(implausible.reason).toBe("implausible");
  });

  it("converts HbA1c from IFCC mmol/mol using the affine formula, not a scale factor", () => {
    // 53 mmol/mol is 7.0%. A plain multiply would be wildly wrong.
    const result = convertToCanonical("hba1c", 53, "mmol/mol");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeCloseTo(7.0, 1);
  });

  it("converts glucose and cholesterol from mmol/L with the right per-analyte factor", () => {
    const glucose = convertToCanonical("fasting_glucose", 5.5, "mmol/L");
    expect(glucose.ok && Math.round(glucose.value)).toBe(99);

    const chol = convertToCanonical("total_cholesterol", 5.2, "mmol/L");
    expect(chol.ok && Math.round(chol.value)).toBe(201);

    // Triglycerides use a different molecular weight to cholesterol — using
    // the cholesterol factor here is a classic silent error.
    const trig = convertToCanonical("triglycerides", 1.7, "mmol/L");
    expect(trig.ok && Math.round(trig.value)).toBe(151);
  });

  it("passes a canonical-unit value straight through unconverted", () => {
    const result = convertToCanonical("creatinine", 1.1, "mg/dL");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(1.1);
      expect(result.converted).toBe(false);
    }
  });

  it("rejects an unknown analyte code", () => {
    expect(convertToCanonical("not_real", 1, "mg/dL").ok).toBe(false);
  });
});

describe("orientationRange", () => {
  it("returns a sex-specific band where the catalogue defines one", () => {
    expect(orientationRange("creatinine", "male")).toEqual({ low: 0.7, high: 1.3 });
    expect(orientationRange("creatinine", "female")).toEqual({ low: 0.6, high: 1.1 });
  });

  it("returns null for a sex-specific analyte when sex is unknown, rather than picking one", () => {
    expect(orientationRange("creatinine", null)).toBeNull();
    expect(orientationRange("haemoglobin", "other")).toBeNull();
  });

  it("returns the shared band for analytes that do not vary by sex", () => {
    expect(orientationRange("potassium", null)).toEqual({ low: 3.5, high: 5.1 });
  });
});

describe("catalogue integrity", () => {
  it("has no duplicate codes", () => {
    const codes = ANALYTE_CATALOGUE.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("keeps every pre-existing analyte code that historical rows already use", () => {
    // Renaming any of these would orphan every trend already stored.
    for (const code of [
      "hba1c",
      "fasting_glucose",
      "total_cholesterol",
      "hdl_cholesterol",
      "ldl_cholesterol",
      "triglycerides",
      "psa",
    ]) {
      expect(getAnalyte(code)).toBeDefined();
    }
  });

  it("keeps every reference band coherent and inside the plausible ceiling", () => {
    for (const analyte of ANALYTE_CATALOGUE) {
      const [low, high] = analyte.plausible;
      expect(low).toBeLessThan(high);
      if (analyte.refHigh !== undefined) expect(analyte.refHigh).toBeLessThanOrEqual(high);
      if (analyte.refLow !== undefined) {
        expect(analyte.refLow).toBeGreaterThanOrEqual(0);
        // refLow may sit below the plausibility floor only as the explicit
        // "no lower bound of interest" sentinel (see AnalyteDefinition).
        if (analyte.refLow > 0) expect(analyte.refLow).toBeGreaterThanOrEqual(low);
        if (analyte.refHigh !== undefined) expect(analyte.refLow).toBeLessThan(analyte.refHigh);
      }
      if (analyte.refBySex) {
        for (const [bandLow, bandHigh] of Object.values(analyte.refBySex)) {
          expect(bandLow).toBeLessThan(bandHigh);
          expect(bandHigh).toBeLessThanOrEqual(high);
        }
      }
    }
  });

  it("resolves every analyte from its own label", () => {
    for (const analyte of ANALYTE_CATALOGUE) {
      expect(resolveAnalyteCode(analyte.label)).toBe(analyte.code);
    }
  });
});
