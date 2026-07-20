import { z } from "zod";

const noteField = z.string().trim().max(500).optional();

/** Raw string from a datetime-local input; converted to an ISO string in the Server Action. */
const takenAtField = z
  .string()
  .optional()
  .refine((value) => !value || !Number.isNaN(Date.parse(value)), {
    message: "Enter a valid date and time",
  });

export const bloodPressureSchema = z.object({
  vital_type: z.literal("blood_pressure"),
  systolic: z.coerce
    .number()
    .int()
    .min(60, "Systolic must be at least 60 mmHg")
    .max(200, "Systolic must be at most 200 mmHg"),
  diastolic: z.coerce
    .number()
    .int()
    .min(40, "Diastolic must be at least 40 mmHg")
    .max(130, "Diastolic must be at most 130 mmHg"),
  note: noteField,
  taken_at: takenAtField,
});

/**
 * Physiologically-possible range per unit — deliberately WIDE. Diabetes
 * pathway §10.3 rejects only "implausible glucose (e.g. <1 or >40 mmol/L)".
 * The old 2–33 mmol/L clamp rejected the exact emergency values the red-flag
 * engine must capture — a true severe hypo (~1.5) or a DKA-range high (>33) —
 * so those are now accepted and routed to assess-glucose as a red flag rather
 * than blocked as "invalid input".
 */
export const GLUCOSE_RANGE = {
  mmol_l: { min: 1, max: 40, label: "mmol/L" },
  mg_dl: { min: 18, max: 720, label: "mg/dL" },
} as const;

export const GLUCOSE_UNITS = ["mmol_l", "mg_dl"] as const;
export type GlucoseUnit = (typeof GLUCOSE_UNITS)[number];

/** §10.1 context tags — a meaningful time-in-range needs pre/post-meal split. */
export const GLUCOSE_CONTEXTS = [
  "fasting",
  "pre_meal",
  "post_meal",
  "bedtime",
  "night",
  "random",
] as const;

export const glucoseSchema = z.object({
  vital_type: z.literal("glucose"),
  glucose_value: z.coerce.number(),
  glucose_unit: z.enum(GLUCOSE_UNITS),
  glucose_context: z.enum(GLUCOSE_CONTEXTS),
  note: noteField,
  taken_at: takenAtField,
});

/**
 * Ketones (§10.1, §15.3) — a blood value (mmol/L) OR a urine dipstick band,
 * captured in the same structured record. Either is enough to fire the DKA
 * workflow when glucose is high. Stored in vitals_readings.ketones_mmol_l /
 * ketone_urine; ketone_kind is a form discriminator, not a DB column.
 */
export const KETONE_URINE_BANDS = ["negative", "trace", "small", "moderate", "large"] as const;

export const ketonesSchema = z.object({
  vital_type: z.literal("ketones"),
  ketone_kind: z.enum(["blood", "urine"]),
  ketones_mmol_l: z.coerce.number().min(0).max(20).optional(),
  ketone_urine: z.enum(KETONE_URINE_BANDS).optional(),
  note: noteField,
  taken_at: takenAtField,
});

export const weightSchema = z.object({
  vital_type: z.literal("weight"),
  weight_kg: z.coerce
    .number()
    .min(20, "Weight must be at least 20 kg")
    .max(300, "Weight must be at most 300 kg"),
  note: noteField,
  taken_at: takenAtField,
});

export const pulseSchema = z.object({
  vital_type: z.literal("pulse"),
  pulse_bpm: z.coerce
    .number()
    .int()
    .min(40, "Pulse must be at least 40 bpm")
    .max(200, "Pulse must be at most 200 bpm"),
  note: noteField,
  taken_at: takenAtField,
});

export const temperatureSchema = z.object({
  vital_type: z.literal("temperature"),
  temperature_c: z.coerce
    .number()
    .min(35, "Temperature must be at least 35°C")
    .max(42, "Temperature must be at most 42°C"),
  note: noteField,
  taken_at: takenAtField,
});

export const waistSchema = z.object({
  vital_type: z.literal("waist_circumference"),
  waist_cm: z.coerce
    .number()
    .min(40, "Waist must be at least 40 cm")
    .max(200, "Waist must be at most 200 cm"),
  note: noteField,
  taken_at: takenAtField,
});

export const spo2Schema = z.object({
  vital_type: z.literal("spo2"),
  spo2_pct: z.coerce
    .number()
    .int()
    .min(70, "SpO2 must be at least 70%")
    .max(100, "SpO2 must be at most 100%"),
  note: noteField,
  taken_at: takenAtField,
});

export const waistCircumferenceSchema = z.object({
  vital_type: z.literal("waist_circumference"),
  waist_cm: z.coerce
    .number()
    .min(40, "Waist must be at least 40 cm")
    .max(200, "Waist must be at most 200 cm"),
  note: noteField,
  taken_at: takenAtField,
});

export const vitalsReadingSchema = z
  .discriminatedUnion("vital_type", [
    bloodPressureSchema,
    glucoseSchema,
    ketonesSchema,
    weightSchema,
    pulseSchema,
    temperatureSchema,
    spo2Schema,
    waistSchema,
    waistCircumferenceSchema,
  ])
  .superRefine((data, ctx) => {
    if (data.vital_type === "glucose") {
      const range = GLUCOSE_RANGE[data.glucose_unit];
      if (data.glucose_value < range.min || data.glucose_value > range.max) {
        ctx.addIssue({
          code: "custom",
          path: ["glucose_value"],
          message: `Glucose must be between ${range.min} and ${range.max} ${range.label}`,
        });
      }
      return;
    }
    if (data.vital_type === "ketones") {
      if (data.ketone_kind === "blood" && data.ketones_mmol_l === undefined) {
        ctx.addIssue({ code: "custom", path: ["ketones_mmol_l"], message: "Enter a blood ketone value" });
      }
      if (data.ketone_kind === "urine" && data.ketone_urine === undefined) {
        ctx.addIssue({ code: "custom", path: ["ketone_urine"], message: "Select a urine ketone level" });
      }
    }
  });
export type VitalsReadingInput = z.infer<typeof vitalsReadingSchema>;
