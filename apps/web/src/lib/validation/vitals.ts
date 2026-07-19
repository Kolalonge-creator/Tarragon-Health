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

/** Clinically sane range per unit, since a patient may enter either. */
export const GLUCOSE_RANGE = {
  mmol_l: { min: 2, max: 33, label: "mmol/L" },
  mg_dl: { min: 36, max: 594, label: "mg/dL" },
} as const;

export const GLUCOSE_UNITS = ["mmol_l", "mg_dl"] as const;
export type GlucoseUnit = (typeof GLUCOSE_UNITS)[number];

export const glucoseSchema = z.object({
  vital_type: z.literal("glucose"),
  glucose_value: z.coerce.number(),
  glucose_unit: z.enum(GLUCOSE_UNITS),
  glucose_context: z.enum(["fasting", "random", "post_meal"]),
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
    weightSchema,
    pulseSchema,
    temperatureSchema,
    spo2Schema,
    waistCircumferenceSchema,
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
export type VitalsReadingInput = z.infer<typeof vitalsReadingSchema>;
