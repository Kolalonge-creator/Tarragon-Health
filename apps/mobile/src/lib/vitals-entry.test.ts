import {
  bloodPressureSchema,
  glucoseSchema,
  pulseSchema,
  spo2Schema,
  temperatureSchema,
  weightSchema,
} from "../../../web/src/lib/validation/vitals";
import { mgDlToMmolL } from "@tarragon/shared";
import {
  BP_BOUNDS,
  GLUCOSE_BOUNDS,
  OTHER_VITAL_BOUNDS,
  parseStrictNumber,
  validateBpEntry,
  validateOtherEntry,
} from "./vitals-entry";

describe("parseStrictNumber", () => {
  it.each([
    ["120", 120],
    [" 120 ", 120],
    ["5,6", 5.6],
    ["5.6", 5.6],
  ])("%j parses to %s", (raw, expected) => expect(parseStrictNumber(raw)).toBe(expected));

  it.each(["", "  ", "12abc", "abc", "1e999", "NaN", "Infinity"])("rejects %j", (raw) => expect(parseStrictNumber(raw)).toBeNull());
});

describe("validateBpEntry", () => {
  it("accepts a normal reading and a crisis-range one (a dangerous value must still submit)", () => {
    expect(validateBpEntry("124", "82")).toEqual({ ok: true, systolic: 124, diastolic: 82 });
    expect(validateBpEntry("210", "130")).toEqual({ ok: true, systolic: 210, diastolic: 130 });
  });

  it("rejects missing or non-numeric input", () => {
    expect(validateBpEntry("", "80")).toEqual({ ok: false, error: "numbers" });
    expect(validateBpEntry("120", "8o")).toEqual({ ok: false, error: "numbers" });
  });

  it("rejects values no person could produce, at both ends", () => {
    expect(validateBpEntry("59", "40")).toEqual({ ok: false, error: "range" });
    expect(validateBpEntry("261", "100")).toEqual({ ok: false, error: "range" });
    expect(validateBpEntry("120", "29")).toEqual({ ok: false, error: "range" });
    expect(validateBpEntry("200", "161")).toEqual({ ok: false, error: "range" });
  });

  it("rejects numbers entered the wrong way round", () => {
    expect(validateBpEntry("80", "120")).toEqual({ ok: false, error: "order" });
    expect(validateBpEntry("90", "90")).toEqual({ ok: false, error: "order" });
  });
});

describe("validateOtherEntry", () => {
  it("accepts in-range values and names the unit mix-up for glucose", () => {
    expect(validateOtherEntry("weight", "74.5", "mmol_l")).toEqual({ ok: true, value: 74.5 });
    expect(validateOtherEntry("glucose", "5.6", "mmol_l")).toEqual({ ok: true, value: 5.6 });
    expect(validateOtherEntry("glucose", "120", "mmol_l")).toEqual({ ok: false, error: "range_glucose_mmol" });
    expect(validateOtherEntry("glucose", "5", "mg_dl")).toEqual({ ok: false, error: "range_glucose_mgdl" });
  });

  it.each([
    ["weight", "19", "range_weight"],
    ["temperature", "46", "range_temperature"],
    ["spo2", "49", "range_spo2"],
    ["pulse", "301", "range_pulse"],
  ] as const)("%s %s is out of range", (type, raw, error) => {
    expect(validateOtherEntry(type, raw, "mmol_l")).toEqual({ ok: false, error });
  });

  it("rejects non-numbers", () => {
    expect(validateOtherEntry("pulse", "fast", "mmol_l")).toEqual({ ok: false, error: "number" });
  });
});

/**
 * The phone's typo gates must never be wider than the server's bands, or a typo
 * becomes a reading the server will never accept (a stuck outbox row). Every bound
 * the phone allows is run through the server's own schema.
 */
describe("phone bounds are never wider than the server's (apps/web validation)", () => {
  it("blood pressure at the phone's extremes passes the server", () => {
    for (const [systolic, diastolic] of [
      [BP_BOUNDS.systolic.min, BP_BOUNDS.diastolic.min],
      [BP_BOUNDS.systolic.max, BP_BOUNDS.diastolic.max],
      [BP_BOUNDS.systolic.max, BP_BOUNDS.diastolic.min],
    ]) {
      expect(bloodPressureSchema.safeParse({ vital_type: "blood_pressure", systolic, diastolic }).success).toBe(true);
    }
  });

  it.each([
    ["weight", weightSchema, "weight_kg"],
    ["temperature", temperatureSchema, "temperature_c"],
    ["spo2", spo2Schema, "spo2_pct"],
    ["pulse", pulseSchema, "pulse_bpm"],
  ] as const)("%s extremes pass the server", (type, schema, field) => {
    const { min, max } = OTHER_VITAL_BOUNDS[type];
    for (const v of [min, max]) expect(schema.safeParse({ vital_type: type, [field]: v }).success).toBe(true);
  });

  it("glucose extremes pass the server in both units", () => {
    for (const unit of ["mmol_l", "mg_dl"] as const) {
      const { min, max } = GLUCOSE_BOUNDS[unit];
      for (const v of [min, max]) {
        const parsed = glucoseSchema.safeParse({ vital_type: "glucose", glucose_value: v, glucose_unit: unit, glucose_context: "random" });
        expect(parsed.success).toBe(true);
      }
    }
    expect(mgDlToMmolL(GLUCOSE_BOUNDS.mg_dl.max)).toBeLessThanOrEqual(GLUCOSE_BOUNDS.mmol_l.max + 0.5);
  });
});
