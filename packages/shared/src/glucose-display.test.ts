import {
  DEFAULT_GLUCOSE_DISPLAY_UNIT,
  formatGlucose,
  glucoseInDisplayUnit,
  mgDlToMmolL,
} from "./index";

describe("glucose display unit", () => {
  it("defaults to mg/dL, which is what meters sold in Nigeria read", () => {
    expect(DEFAULT_GLUCOSE_DISPLAY_UNIT).toBe("mg_dl");
  });

  it("shows a stored mmol/L reading as the whole mg/dL number a meter displays", () => {
    // 6.1 mmol/L is the figure a patient used to be shown after typing 110.
    expect(formatGlucose(6.1, "mg_dl")).toBe("110 mg/dL");
    expect(formatGlucose(6.1, "mmol_l")).toBe("6.1 mmol/L");
  });

  it("round-trips a typed mg/dL value back to the same displayed number", () => {
    // The actual patient journey: type 110 on a mg/dL meter, have it stored as
    // mmol/L, and read 110 back off the dashboard. This is the whole point.
    for (const typed of [70, 110, 126, 180, 250]) {
      expect(formatGlucose(mgDlToMmolL(typed), "mg_dl")).toBe(`${typed} mg/dL`);
    }
  });

  it("gives mg/dL no decimals and mmol/L exactly one, matching each unit's meters", () => {
    expect(formatGlucose(10, "mg_dl", { withUnit: false })).toBe("180");
    expect(formatGlucose(10, "mmol_l", { withUnit: false })).toBe("10.0");
  });

  it("renders the clinical hypo threshold as the number the meter can show", () => {
    // The diabetes guidance said "below 3.9 mmol/L" to every patient,
    // including those whose meter never displays a value under 70.
    expect(formatGlucose(3.9, "mg_dl")).toBe("70 mg/dL");
  });

  it("returns null rather than a fabricated figure for a missing reading", () => {
    expect(formatGlucose(null, "mg_dl")).toBeNull();
    expect(formatGlucose(undefined, "mmol_l")).toBeNull();
    expect(formatGlucose(Number.NaN, "mg_dl")).toBeNull();
  });

  it("plots a chart point in the display unit", () => {
    expect(glucoseInDisplayUnit(6.1, "mg_dl")).toBe(110);
    expect(glucoseInDisplayUnit(6.14, "mmol_l")).toBe(6.1);
  });
});
