import { z } from "zod";
import { GLUCOSE_RANGE, GLUCOSE_UNITS } from "./vitals";

const deviceIdField = z.string().uuid();
/** BLE measurement sequence number (glucose) or a locally-derived
 * idempotency key (blood pressure has none in the GATT spec) — paired with
 * device_id to dedupe a resync/retry, per vitals_readings_device_dedupe_idx. */
const externalReadingIdField = z.string().trim().min(1).max(200);
const takenAtField = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "taken_at must be a valid ISO date-time",
});

/**
 * Same full plausible bands as the manual-entry path (SBP 60-260, DBP 30-160,
 * pulse 20-300 — see ./vitals.ts). The old 60-200 / 40-130 clamp here was left
 * behind when the manual path was widened, so a BLE cuff reporting a true
 * hypertensive crisis (210/125) was rejected at the ingestion boundary — the
 * single most dangerous reading private.classify_bp_level exists to catch
 * (emergency at SBP >= 200 or DBP >= 120). A measuring instrument's reading
 * must be able to reach the escalation pipeline; only physically-implausible
 * values are rejected. Pulse follows private.classify_pulse_level, whose
 * emergency band is <= 35 / >= 150 bpm.
 */
export const deviceBloodPressureSchema = z.object({
  vital_type: z.literal("blood_pressure"),
  device_id: deviceIdField,
  external_reading_id: externalReadingIdField,
  taken_at: takenAtField,
  systolic: z
    .number()
    .int()
    .min(60, "Systolic must be at least 60 mmHg")
    .max(260, "Systolic must be at most 260 mmHg"),
  diastolic: z
    .number()
    .int()
    .min(30, "Diastolic must be at least 30 mmHg")
    .max(160, "Diastolic must be at most 160 mmHg"),
  pulse_bpm: z.number().int().min(20).max(300).optional(),
});

export const deviceGlucoseSchema = z.object({
  vital_type: z.literal("glucose"),
  device_id: deviceIdField,
  external_reading_id: externalReadingIdField,
  taken_at: takenAtField,
  glucose_value: z.number(),
  glucose_unit: z.enum(GLUCOSE_UNITS),
  // The Glucose Measurement GATT characteristic carries no fasting/random/
  // post-meal concept — the mobile app must ask the patient before it
  // submits the reading, same as the manual-entry form does.
  glucose_context: z.enum(["fasting", "random", "post_meal"]),
});

export const deviceWeightSchema = z.object({
  vital_type: z.literal("weight"),
  device_id: deviceIdField,
  external_reading_id: externalReadingIdField,
  taken_at: takenAtField,
  weight_kg: z.number().min(20, "Weight must be at least 20 kg").max(300, "Weight must be at most 300 kg"),
});

export const deviceTemperatureSchema = z.object({
  vital_type: z.literal("temperature"),
  device_id: deviceIdField,
  external_reading_id: externalReadingIdField,
  taken_at: takenAtField,
  // Identical to the manual-entry band (./vitals.ts, 30-45): the manual path
  // was widened to match this one, so the two are deliberately the same now.
  // Kept explicit rather than imported because the reason each side holds
  // this band differs — a thermometer is a measuring instrument whose
  // clinically meaningful hypothermia/hyperpyrexia readings must not be
  // rejected at the ingestion boundary, and private.classify_temperature_
  // level calls anything below 35.0°C an emergency either way.
  temperature_c: z
    .number()
    .min(30, "Temperature must be at least 30°C")
    .max(45, "Temperature must be at most 45°C"),
});

export const deviceSpo2Schema = z.object({
  vital_type: z.literal("spo2"),
  device_id: deviceIdField,
  external_reading_id: externalReadingIdField,
  taken_at: takenAtField,
  // Oximeters legitimately report severe hypoxaemia, which is exactly the
  // reading that must reach the escalation pipeline rather than bounce off
  // validation. The manual form was left on a 70 floor when this was widened
  // and has since been brought to the same 50 (./vitals.ts), so the two
  // paths now agree.
  spo2_pct: z.number().int().min(50, "SpO2 must be at least 50%").max(100, "SpO2 must be at most 100%"),
  // Same 20-300 pulse band as the BP schema above and the manual path — an
  // oximeter's pulse reading is the same fact from a different instrument.
  pulse_bpm: z.number().int().min(20).max(300).optional(),
});

export const deviceReadingSchema = z
  .discriminatedUnion("vital_type", [
    deviceBloodPressureSchema,
    deviceGlucoseSchema,
    deviceWeightSchema,
    deviceTemperatureSchema,
    deviceSpo2Schema,
  ])
  .superRefine((data, ctx) => {
    if (data.vital_type !== "glucose") return;
    const range = GLUCOSE_RANGE[data.glucose_unit];
    if (data.glucose_value < range.min || data.glucose_value > range.max) {
      ctx.addIssue({
        code: "custom",
        path: ["glucose_value"],
        message: `Glucose must be between ${range.min} and ${range.max} ${range.label}`,
      });
    }
  });

export type DeviceReadingInput = z.infer<typeof deviceReadingSchema>;
