import { describe, expect, it } from "@jest/globals";
import { deviceReadingSchema } from "./device-reading";

const deviceId = "11111111-1111-1111-8111-111111111111";

describe("deviceReadingSchema — blood_pressure", () => {
  const valid = {
    vital_type: "blood_pressure",
    device_id: deviceId,
    external_reading_id: "seq-1",
    taken_at: "2026-07-13T08:30:00.000Z",
    systolic: 120,
    diastolic: 80,
  };

  it("accepts a valid reading", () => {
    expect(deviceReadingSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts an optional pulse_bpm", () => {
    expect(deviceReadingSchema.safeParse({ ...valid, pulse_bpm: 72 }).success).toBe(true);
  });

  it("rejects systolic out of range", () => {
    expect(deviceReadingSchema.safeParse({ ...valid, systolic: 59 }).success).toBe(false);
  });

  it("rejects a non-uuid device_id", () => {
    expect(deviceReadingSchema.safeParse({ ...valid, device_id: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects a missing external_reading_id", () => {
    const withoutId: Record<string, unknown> = { ...valid };
    delete withoutId.external_reading_id;
    expect(deviceReadingSchema.safeParse(withoutId).success).toBe(false);
  });

  it("rejects an invalid taken_at", () => {
    expect(deviceReadingSchema.safeParse({ ...valid, taken_at: "not-a-date" }).success).toBe(false);
  });

  it("rejects a string systolic (device payloads are JSON numbers, not FormData strings)", () => {
    expect(deviceReadingSchema.safeParse({ ...valid, systolic: "120" }).success).toBe(false);
  });
});

describe("deviceReadingSchema — glucose", () => {
  const valid = {
    vital_type: "glucose",
    device_id: deviceId,
    external_reading_id: "42",
    taken_at: "2026-07-13T08:30:00.000Z",
    glucose_value: 5.6,
    glucose_unit: "mmol_l",
    glucose_context: "fasting",
  };

  it("accepts a valid reading", () => {
    expect(deviceReadingSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects glucose out of range for the given unit", () => {
    expect(deviceReadingSchema.safeParse({ ...valid, glucose_value: 0.5 }).success).toBe(false);
  });

  it("requires glucose_context (the GATT characteristic doesn't carry it)", () => {
    const withoutContext: Record<string, unknown> = { ...valid };
    delete withoutContext.glucose_context;
    expect(deviceReadingSchema.safeParse(withoutContext).success).toBe(false);
  });
});

describe("deviceReadingSchema — weight", () => {
  const valid = {
    vital_type: "weight",
    device_id: deviceId,
    external_reading_id: "1",
    taken_at: "2026-07-13T08:30:00.000Z",
    weight_kg: 70,
  };

  it("accepts a valid reading", () => {
    expect(deviceReadingSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects weight out of range", () => {
    expect(deviceReadingSchema.safeParse({ ...valid, weight_kg: 10 }).success).toBe(false);
  });
});

describe("deviceReadingSchema — discriminated union shape", () => {
  it("rejects an unknown vital_type", () => {
    expect(
      deviceReadingSchema.safeParse({
        vital_type: "spo2",
        device_id: deviceId,
        external_reading_id: "1",
        taken_at: "2026-07-13T08:30:00.000Z",
        spo2_pct: 98,
      }).success
    ).toBe(false);
  });
});
