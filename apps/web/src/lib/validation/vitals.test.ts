import { describe, expect, it } from "@jest/globals";
import { vitalsReadingSchema } from "./vitals";

describe("vitalsReadingSchema — blood_pressure", () => {
  const valid = { vital_type: "blood_pressure", systolic: "120", diastolic: "80" };

  it("accepts a valid reading", () => {
    expect(vitalsReadingSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects systolic below 60", () => {
    expect(
      vitalsReadingSchema.safeParse({ ...valid, systolic: "59" }).success
    ).toBe(false);
  });

  it("rejects systolic above 200", () => {
    expect(
      vitalsReadingSchema.safeParse({ ...valid, systolic: "201" }).success
    ).toBe(false);
  });

  it("rejects diastolic below 40", () => {
    expect(
      vitalsReadingSchema.safeParse({ ...valid, diastolic: "39" }).success
    ).toBe(false);
  });

  it("rejects diastolic above 130", () => {
    expect(
      vitalsReadingSchema.safeParse({ ...valid, diastolic: "131" }).success
    ).toBe(false);
  });
});

describe("vitalsReadingSchema — glucose", () => {
  const valid = {
    vital_type: "glucose",
    glucose_mmol_l: "5.6",
    glucose_context: "fasting",
  };

  it("accepts a valid reading", () => {
    expect(vitalsReadingSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects glucose below 2", () => {
    expect(
      vitalsReadingSchema.safeParse({ ...valid, glucose_mmol_l: "1" }).success
    ).toBe(false);
  });

  it("rejects glucose above 33", () => {
    expect(
      vitalsReadingSchema.safeParse({ ...valid, glucose_mmol_l: "34" }).success
    ).toBe(false);
  });

  it("rejects a missing glucose_context", () => {
    expect(
      vitalsReadingSchema.safeParse({
        vital_type: "glucose",
        glucose_mmol_l: "5.6",
      }).success
    ).toBe(false);
  });

  it("rejects an invalid glucose_context", () => {
    expect(
      vitalsReadingSchema.safeParse({ ...valid, glucose_context: "before_bed" })
        .success
    ).toBe(false);
  });
});

describe("vitalsReadingSchema — weight", () => {
  const valid = { vital_type: "weight", weight_kg: "70" };

  it("accepts a valid reading", () => {
    expect(vitalsReadingSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects weight below 20", () => {
    expect(
      vitalsReadingSchema.safeParse({ ...valid, weight_kg: "19" }).success
    ).toBe(false);
  });

  it("rejects weight above 300", () => {
    expect(
      vitalsReadingSchema.safeParse({ ...valid, weight_kg: "301" }).success
    ).toBe(false);
  });
});

describe("vitalsReadingSchema — pulse", () => {
  const valid = { vital_type: "pulse", pulse_bpm: "72" };

  it("accepts a valid reading", () => {
    expect(vitalsReadingSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects pulse below 40", () => {
    expect(
      vitalsReadingSchema.safeParse({ ...valid, pulse_bpm: "39" }).success
    ).toBe(false);
  });

  it("rejects pulse above 200", () => {
    expect(
      vitalsReadingSchema.safeParse({ ...valid, pulse_bpm: "201" }).success
    ).toBe(false);
  });
});

describe("vitalsReadingSchema — temperature", () => {
  const valid = { vital_type: "temperature", temperature_c: "37" };

  it("accepts a valid reading", () => {
    expect(vitalsReadingSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects temperature below 35", () => {
    expect(
      vitalsReadingSchema.safeParse({ ...valid, temperature_c: "34.9" }).success
    ).toBe(false);
  });

  it("rejects temperature above 42", () => {
    expect(
      vitalsReadingSchema.safeParse({ ...valid, temperature_c: "42.1" }).success
    ).toBe(false);
  });
});

describe("vitalsReadingSchema — spo2", () => {
  const valid = { vital_type: "spo2", spo2_pct: "98" };

  it("accepts a valid reading", () => {
    expect(vitalsReadingSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects spo2 below 70", () => {
    expect(
      vitalsReadingSchema.safeParse({ ...valid, spo2_pct: "69" }).success
    ).toBe(false);
  });

  it("rejects spo2 above 100", () => {
    expect(
      vitalsReadingSchema.safeParse({ ...valid, spo2_pct: "101" }).success
    ).toBe(false);
  });
});

describe("vitalsReadingSchema — discriminated union shape", () => {
  it("rejects a payload with fields that don't match its vital_type", () => {
    expect(
      vitalsReadingSchema.safeParse({ vital_type: "glucose", systolic: "120" })
        .success
    ).toBe(false);
  });

  it("rejects an unknown vital_type", () => {
    expect(
      vitalsReadingSchema.safeParse({ vital_type: "cholesterol", value: "5" })
        .success
    ).toBe(false);
  });

  it("rejects an out-of-range note", () => {
    expect(
      vitalsReadingSchema.safeParse({
        vital_type: "weight",
        weight_kg: "70",
        note: "x".repeat(501),
      }).success
    ).toBe(false);
  });

  it("rejects an invalid taken_at", () => {
    expect(
      vitalsReadingSchema.safeParse({
        vital_type: "weight",
        weight_kg: "70",
        taken_at: "not-a-date",
      }).success
    ).toBe(false);
  });
});
