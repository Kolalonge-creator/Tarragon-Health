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

export const deviceBloodPressureSchema = z.object({
  vital_type: z.literal("blood_pressure"),
  device_id: deviceIdField,
  external_reading_id: externalReadingIdField,
  taken_at: takenAtField,
  systolic: z
    .number()
    .int()
    .min(60, "Systolic must be at least 60 mmHg")
    .max(200, "Systolic must be at most 200 mmHg"),
  diastolic: z
    .number()
    .int()
    .min(40, "Diastolic must be at least 40 mmHg")
    .max(130, "Diastolic must be at most 130 mmHg"),
  pulse_bpm: z.number().int().min(40).max(200).optional(),
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

export const deviceReadingSchema = z
  .discriminatedUnion("vital_type", [deviceBloodPressureSchema, deviceGlucoseSchema, deviceWeightSchema])
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
