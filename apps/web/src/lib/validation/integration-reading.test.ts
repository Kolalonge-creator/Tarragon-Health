import { describe, expect, it } from "@jest/globals";
import { integrationReadingSchema } from "./integration-reading";

const base = {
  patient_number: "TH-000123",
  device: { type: "bp_cuff", serial: "OMRON-9871234", model: "Omron M7" },
  external_reading_id: "meas-1",
  taken_at: "2026-07-21T08:30:00Z",
};

describe("integrationReadingSchema", () => {
  it("accepts a valid blood pressure reading", () => {
    expect(
      integrationReadingSchema.safeParse({
        ...base,
        vital_type: "blood_pressure",
        systolic: 152,
        diastolic: 96,
        pulse_bpm: 78,
      }).success
    ).toBe(true);
  });

  it("accepts every device type through its matching vital", () => {
    expect(
      integrationReadingSchema.safeParse({
        ...base,
        device: { type: "scale", serial: "S-1" },
        vital_type: "weight",
        weight_kg: 82.5,
      }).success
    ).toBe(true);
    expect(
      integrationReadingSchema.safeParse({
        ...base,
        device: { type: "thermometer", serial: "T-1" },
        vital_type: "temperature",
        temperature_c: 38.4,
      }).success
    ).toBe(true);
    expect(
      integrationReadingSchema.safeParse({
        ...base,
        device: { type: "pulse_oximeter", serial: "P-1" },
        vital_type: "spo2",
        spo2_pct: 94,
      }).success
    ).toBe(true);
  });

  it("enforces the glucose range for the declared unit", () => {
    const glucose = {
      ...base,
      device: { type: "glucometer", serial: "G-1" },
      vital_type: "glucose",
      glucose_unit: "mmol_l",
      glucose_context: "fasting",
    };
    expect(integrationReadingSchema.safeParse({ ...glucose, glucose_value: 7.2 }).success).toBe(true);
    expect(integrationReadingSchema.safeParse({ ...glucose, glucose_value: 700 }).success).toBe(false);
  });

  it("rejects a malformed patient number", () => {
    expect(
      integrationReadingSchema.safeParse({
        ...base,
        patient_number: "12345",
        vital_type: "weight",
        weight_kg: 80,
      }).success
    ).toBe(false);
  });

  it("rejects an unknown device type", () => {
    expect(
      integrationReadingSchema.safeParse({
        ...base,
        device: { type: "cgm", serial: "C-1" },
        vital_type: "glucose",
        glucose_value: 6,
        glucose_unit: "mmol_l",
        glucose_context: "fasting",
      }).success
    ).toBe(false);
  });
});
