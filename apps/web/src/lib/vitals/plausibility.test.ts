import { crosscheckVital } from "./plausibility";

describe("crosscheckVital", () => {
  it("passes a normal blood pressure without a crosscheck", () => {
    expect(
      crosscheckVital({ vital_type: "blood_pressure", systolic: 120, diastolic: 80 })
    ).toBeNull();
  });

  it("flags a high blood pressure but does not block it", () => {
    const result = crosscheckVital({
      vital_type: "blood_pressure",
      systolic: 185,
      diastolic: 110,
    });
    expect(result?.direction).toBe("high");
    expect(result?.message).toMatch(/higher than usual/);
    expect(result?.tips.length).toBeGreaterThan(0);
  });

  it("flags a low blood pressure", () => {
    expect(
      crosscheckVital({ vital_type: "blood_pressure", systolic: 85, diastolic: 55 })?.direction
    ).toBe("low");
  });

  it("bands glucose after converting mg/dL to mmol/L", () => {
    // 250 mg/dL ≈ 13.9 mmol/L → high
    expect(
      crosscheckVital({
        vital_type: "glucose",
        glucose_value: 250,
        glucose_unit: "mg_dl",
        glucose_context: "random",
      })?.direction
    ).toBe("high");
    // 5.5 mmol/L → normal
    expect(
      crosscheckVital({
        vital_type: "glucose",
        glucose_value: 5.5,
        glucose_unit: "mmol_l",
        glucose_context: "fasting",
      })
    ).toBeNull();
    // 3.2 mmol/L → low
    expect(
      crosscheckVital({
        vital_type: "glucose",
        glucose_value: 3.2,
        glucose_unit: "mmol_l",
        glucose_context: "random",
      })?.direction
    ).toBe("low");
  });

  it("flags a low SpO2 only (never high)", () => {
    expect(crosscheckVital({ vital_type: "spo2", spo2_pct: 88 })?.direction).toBe("low");
    expect(crosscheckVital({ vital_type: "spo2", spo2_pct: 98 })).toBeNull();
  });

  it("flags out-of-band pulse and temperature", () => {
    expect(crosscheckVital({ vital_type: "pulse", pulse_bpm: 130 })?.direction).toBe("high");
    expect(crosscheckVital({ vital_type: "pulse", pulse_bpm: 72 })).toBeNull();
    expect(crosscheckVital({ vital_type: "temperature", temperature_c: 39 })?.direction).toBe(
      "high"
    );
    expect(crosscheckVital({ vital_type: "temperature", temperature_c: 36.7 })).toBeNull();
  });

  it("leaves an ordinary weight alone but flags an extreme one", () => {
    expect(crosscheckVital({ vital_type: "weight", weight_kg: 72 })).toBeNull();
    expect(crosscheckVital({ vital_type: "weight", weight_kg: 25 })?.direction).toBe("low");
  });
});
