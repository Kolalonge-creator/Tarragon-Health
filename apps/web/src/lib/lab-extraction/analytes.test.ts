import {
  toCanonicalUnit,
  toProposedReadings,
  normaliseTakenOn,
  CANONICAL_UNIT,
  EXTRACTABLE_ANALYTE_CODES,
} from "./analytes";

/**
 * Unit conversion is done here rather than by the model precisely so it can be
 * pinned by tests. A mis-scaled cholesterol silently corrupts a trend and the
 * CV-risk engine that reads it, and nothing downstream would flag it.
 */
describe("toCanonicalUnit", () => {
  it("passes mg/dL lipids through unchanged", () => {
    expect(toCanonicalUnit("total_cholesterol", 190, "mg/dL")).toEqual({
      value: 190,
      unit: "mg/dL",
    });
  });

  it("converts mmol/L cholesterol to mg/dL", () => {
    // 5.2 mmol/L is a very ordinary total cholesterol; 5.2 mg/dL would be
    // biologically impossible, which is exactly why this must not pass through.
    expect(toCanonicalUnit("total_cholesterol", 5.2, "mmol/L")).toEqual({
      value: 201.08,
      unit: "mg/dL",
    });
  });

  it("uses the triglyceride-specific factor, not the cholesterol one", () => {
    expect(toCanonicalUnit("triglycerides", 1.7, "mmol/L")).toEqual({
      value: 150.57,
      unit: "mg/dL",
    });
  });

  it("uses the glucose-specific factor", () => {
    expect(toCanonicalUnit("fasting_glucose", 5.5, "mmol/L")).toEqual({
      value: 99.09,
      unit: "mg/dL",
    });
  });

  it("converts IFCC HbA1c (mmol/mol) to NGSP percent", () => {
    // Two reference points from the IFCC/NGSP master equation: 48 mmol/mol is
    // the 6.5% diabetes diagnostic threshold, 53 mmol/mol the 7.0% figure most
    // treatment targets are quoted against.
    expect(toCanonicalUnit("hba1c", 48, "mmol/mol")).toEqual({ value: 6.54, unit: "percent" });
    expect(toCanonicalUnit("hba1c", 53, "mmol/mol")).toEqual({ value: 7, unit: "percent" });
  });

  it("passes percent HbA1c through, however the unit is spelled", () => {
    expect(toCanonicalUnit("hba1c", 6.5, "%")).toEqual({ value: 6.5, unit: "percent" });
    expect(toCanonicalUnit("hba1c", 6.5, "Percent")).toEqual({ value: 6.5, unit: "percent" });
  });

  it("treats PSA ug/L as ng/mL (same quantity)", () => {
    expect(toCanonicalUnit("psa", 3.2, "µg/L")).toEqual({ value: 3.2, unit: "ng/mL" });
    expect(toCanonicalUnit("psa", 3.2, "ng/mL")).toEqual({ value: 3.2, unit: "ng/mL" });
  });

  it("is insensitive to spacing and case in the printed unit", () => {
    expect(toCanonicalUnit("ldl_cholesterol", 100, "MG / DL")).toEqual({
      value: 100,
      unit: "mg/dL",
    });
  });

  it("returns null for an unrecognised unit rather than guessing a scale", () => {
    expect(toCanonicalUnit("total_cholesterol", 190, "g/L")).toBeNull();
    expect(toCanonicalUnit("hba1c", 6.5, "mg/dL")).toBeNull();
    expect(toCanonicalUnit("psa", 3.2, "mmol/L")).toBeNull();
  });

  it("returns null for a non-finite value", () => {
    expect(toCanonicalUnit("total_cholesterol", Number.NaN, "mg/dL")).toBeNull();
    expect(toCanonicalUnit("total_cholesterol", Number.POSITIVE_INFINITY, "mg/dL")).toBeNull();
  });

  it("has a canonical unit for every extractable code", () => {
    for (const code of EXTRACTABLE_ANALYTE_CODES) {
      expect(CANONICAL_UNIT[code]).toBeTruthy();
    }
  });
});

describe("normaliseTakenOn", () => {
  it("accepts a plain ISO date", () => {
    expect(normaliseTakenOn("2026-07-14")).toBe("2026-07-14");
  });

  it("trims an ISO datetime down to the date", () => {
    expect(normaliseTakenOn("2026-07-14T09:30:00Z")).toBe("2026-07-14");
  });

  it("rejects a non-ISO date rather than guessing day/month order", () => {
    // 07/08/2026 is ambiguous between two real dates, so it is not a date we
    // are willing to stamp on a clinical reading.
    expect(normaliseTakenOn("07/08/2026")).toBeNull();
    expect(normaliseTakenOn("14 July 2026")).toBeNull();
  });

  it("rejects a future date as a misread", () => {
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    expect(normaliseTakenOn(nextYear.toISOString().slice(0, 10))).toBeNull();
  });

  it("returns null when the document stated no date", () => {
    expect(normaliseTakenOn(undefined)).toBeNull();
    expect(normaliseTakenOn("")).toBeNull();
  });
});

describe("toProposedReadings", () => {
  it("converts, labels, and keeps what was printed for checking", () => {
    const out = toProposedReadings({
      taken_on: "2026-07-14",
      analytes: [{ code: "total_cholesterol", value: 5.2, unit: "mmol/L", source_text: "TC 5.2" }],
    });
    expect(out).toEqual([
      {
        code: "total_cholesterol",
        label: "Total cholesterol",
        value: 201.08,
        unit: "mg/dL",
        asPrinted: "5.2 mmol/L",
        sourceText: "TC 5.2",
        takenOn: "2026-07-14",
      },
    ]);
  });

  it("drops a value whose unit could not be understood, keeping the rest", () => {
    const out = toProposedReadings({
      analytes: [
        { code: "total_cholesterol", value: 190, unit: "mg/dL" },
        { code: "triglycerides", value: 1.2, unit: "furlongs" },
      ],
    });
    expect(out.map((r) => r.code)).toEqual(["total_cholesterol"]);
  });

  it("keeps only the first reading of a repeated analyte", () => {
    const out = toProposedReadings({
      analytes: [
        { code: "hba1c", value: 6.5, unit: "%" },
        { code: "hba1c", value: 9.9, unit: "%" },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe(6.5);
  });

  it("returns nothing when the model found nothing", () => {
    expect(toProposedReadings({ analytes: [] })).toEqual([]);
  });
});
