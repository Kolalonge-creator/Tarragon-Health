import { z } from "zod";
import { GLUCOSE_RANGE, GLUCOSE_UNITS } from "./vitals";

/**
 * Body schema for POST /api/integrations/device-readings — the API-key
 * (server-to-server) ingestion path. Mirrors the mobile BLE path's
 * per-vital ranges (see ./device-reading.ts) but identifies the patient by
 * their human-readable patient_number (partners never hold our UUIDs) and
 * the device by vendor serial instead of an already-paired patient_devices
 * row — the route provisions/reuses that row itself.
 */

const patientNumberField = z
  .string()
  .trim()
  .regex(/^TH-\d{6}$/, "patient_number must look like TH-000123");

const deviceField = z.object({
  type: z.enum(["bp_cuff", "glucometer", "scale", "thermometer", "pulse_oximeter"]),
  /** Vendor-side stable device identifier (serial number / cloud device id). */
  serial: z.string().trim().min(1).max(120),
  model: z.string().trim().max(120).optional(),
});

const baseFields = {
  patient_number: patientNumberField,
  device: deviceField,
  /** Partner-side stable id for this measurement — the idempotency key. */
  external_reading_id: z.string().trim().min(1).max(200),
  taken_at: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "taken_at must be a valid ISO date-time",
  }),
};

export const integrationReadingSchema = z
  .discriminatedUnion("vital_type", [
    z.object({
      ...baseFields,
      vital_type: z.literal("blood_pressure"),
      systolic: z.number().int().min(60).max(200),
      diastolic: z.number().int().min(40).max(130),
      pulse_bpm: z.number().int().min(40).max(200).optional(),
    }),
    z.object({
      ...baseFields,
      vital_type: z.literal("glucose"),
      glucose_value: z.number(),
      glucose_unit: z.enum(GLUCOSE_UNITS),
      glucose_context: z.enum(["fasting", "random", "post_meal"]),
    }),
    z.object({
      ...baseFields,
      vital_type: z.literal("weight"),
      weight_kg: z.number().min(20).max(300),
    }),
    z.object({
      ...baseFields,
      vital_type: z.literal("temperature"),
      temperature_c: z.number().min(30).max(45),
    }),
    z.object({
      ...baseFields,
      vital_type: z.literal("spo2"),
      spo2_pct: z.number().int().min(50).max(100),
      pulse_bpm: z.number().int().min(30).max(250).optional(),
    }),
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

export type IntegrationReadingInput = z.infer<typeof integrationReadingSchema>;
