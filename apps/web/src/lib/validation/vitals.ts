import { z } from "zod";

const noteField = z.string().trim().max(500).optional();

/**
 * Raw string from a datetime-local input; converted to an ISO string in the
 * Server Action. No current form actually renders that input, and even if
 * one is added, this value is silently overridden server-side for any
 * manual-source reading (private.stamp_manual_vitals_timestamp,
 * 20260831001537) — manual entries have no legitimate need to backdate
 * taken_at, unlike device/wearable/CGM/FHIR-import sources, which set it
 * through a different path (the device-readings/cgm-readings/wearables
 * ingestion routes) that this trigger deliberately leaves untouched.
 */
const takenAtField = z
  .string()
  .optional()
  .refine((value) => !value || !Number.isNaN(Date.parse(value)), {
    message: "Enter a valid date and time",
  });

export const bloodPressureSchema = z
  .object({
    vital_type: z.literal("blood_pressure"),
    // Full plausible range per TH-CP-HTN-001 §5.4 (SBP 60-260, DBP 30-160). The
    // old 60-200 / 40-130 clamp rejected true hypertensive-crisis readings
    // (e.g. 210/125) — the single most dangerous values the BP red-flag engine
    // exists to catch. A genuine crisis reading must be enterable so it can
    // escalate; only physically-implausible entries are rejected.
    systolic: z.coerce
      .number()
      .int()
      .min(60, "Systolic must be at least 60 mmHg")
      .max(260, "Please re-check — systolic above 260 mmHg is outside the measurable range"),
    diastolic: z.coerce
      .number()
      .int()
      .min(30, "Diastolic must be at least 30 mmHg")
      .max(160, "Please re-check — diastolic above 160 mmHg is outside the measurable range"),
    note: noteField,
    taken_at: takenAtField,
  })
  .refine((data) => data.systolic > data.diastolic, {
    path: ["systolic"],
    message: "Systolic must be higher than diastolic — please re-check the two numbers",
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

/**
 * Full plausible pulse range — deliberately WIDE, same reasoning as the BP
 * band above. The old 40-200 clamp rejected every value the live pulse
 * red-flag engine exists to catch: private.classify_pulse_level treats
 * <=35 bpm and >=150 bpm as EMERGENCY and 36-39 bpm as RED, so a genuine
 * bradycardic arrest-range reading (30 bpm) or a tachyarrhythmia (220 bpm)
 * was physically unenterable — the form and POST /api/mobile/vitals both
 * 400'd it, and the mobile offline queue then retried forever without ever
 * surfacing the failure. 20-300 matches the bounds the mobile client
 * already applies before it submits (vitals-screen.tsx OTHER_VITAL_BOUNDS);
 * only values no live human could produce are rejected.
 */
export const pulseSchema = z.object({
  vital_type: z.literal("pulse"),
  pulse_bpm: z.coerce
    .number()
    .int()
    .min(20, "Pulse must be at least 20 bpm")
    .max(300, "Please re-check — a pulse above 300 bpm is outside the measurable range"),
  note: noteField,
  taken_at: takenAtField,
});

/**
 * Full plausible temperature range — same reasoning again. The old 35-42
 * clamp rejected hypothermia outright: private.classify_temperature_level
 * treats anything below 35.0°C as EMERGENCY, so the exact reading the
 * engine must escalate could never be saved. 30-45 matches both the device
 * ingestion band (./device-reading.ts) and the mobile client's own bounds.
 */
export const temperatureSchema = z.object({
  vital_type: z.literal("temperature"),
  temperature_c: z.coerce
    .number()
    .min(30, "Temperature must be at least 30°C")
    .max(45, "Please re-check — a temperature above 45°C is outside the measurable range"),
  note: noteField,
  taken_at: takenAtField,
});

/**
 * Full plausible SpO2 range — same reasoning as the BP, pulse and
 * temperature bands above, and the last of the four manual bands still
 * clamped tighter than the engine that reads it. private.classify_spo2_level
 * treats anything below 90% as EMERGENCY, so the old 70 floor rejected the
 * whole emergency band below it: a patient reading 65 off their oximeter was
 * told the number was invalid rather than being routed to emergency_events.
 * 50 matches the device ingestion band (./device-reading.ts), for the reason
 * written there — oximeters legitimately report severe hypoxaemia, which is
 * exactly the reading that must reach the escalation pipeline rather than
 * bounce off validation. A person typing what their meter shows is reporting
 * the same fact as the meter uploading it.
 */
export const spo2Schema = z.object({
  vital_type: z.literal("spo2"),
  spo2_pct: z.coerce
    .number()
    .int()
    .min(50, "SpO2 must be at least 50%")
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
