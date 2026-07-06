import { z } from "zod";
import type { Enums } from "@tarragon/shared";

export const SMOKING_STATUSES = ["never", "former", "current"] as const;
export const CIGARETTES_PER_DAY = ["1_5", "6_10", "11_20", "20_plus"] as const;
export const ALCOHOL_USES = ["none", "moderate", "heavy"] as const;
export const SLEEP_HOURS = ["less_than_5", "5_to_6", "7_to_8", "more_than_8"] as const;
export const STRESS_LEVELS = ["low", "moderate", "high"] as const;
export const DIET_TAGS = [
  "balanced",
  "high_sugar",
  "high_salt",
  "high_fat",
  "vegetarian",
  "low_fibre",
] as const;
export const CANCER_TYPES = ["breast", "cervical", "colorectal", "prostate", "other"] as const;
export const EXISTING_DIAGNOSES = [
  "hypertension",
  "diabetes",
  "heart_disease",
  "high_cholesterol",
  "other",
] as const;

/**
 * The full risk assessment questionnaire (spec §3.2). Every question maps to
 * a stored, structured field — never free text — so it can drive the rules
 * engine (apps/web/src/lib/rules/risk-scoring.ts). The `*_other_detail`,
 * `current_medications`, and `other_vaccines_detail` fields are the
 * deliberate exceptions (spec: "free text + structured tags").
 */
export const riskAssessmentSchema = z
  .object({
    // family_history
    family_diabetes: z.coerce.boolean(),
    family_hypertension: z.coerce.boolean(),
    family_heart_disease: z.coerce.boolean(),
    family_sickle_cell: z.coerce.boolean(),
    family_cancer_types: z.array(z.enum(CANCER_TYPES)),
    family_cancer_other_detail: z.string().trim().max(300).optional(),

    // lifestyle
    smoking_status: z.enum(SMOKING_STATUSES),
    cigarettes_per_day: z.enum(CIGARETTES_PER_DAY).optional(),
    alcohol_use: z.enum(ALCOHOL_USES),
    exercise_days_per_week: z.coerce.number().int().min(0).max(7),
    exercise_minutes_per_session: z.coerce.number().int().min(0).max(300),
    diet_pattern: z.array(z.enum(DIET_TAGS)),
    sleep_hours: z.enum(SLEEP_HOURS),
    stress_level: z.enum(STRESS_LEVELS),
    // Feeds BMI alongside weight_kg below (or the patient's most recent
    // vitals_readings.weight_kg if weight_kg is left blank).
    height_cm: z.coerce
      .number()
      .min(100, "Height must be at least 100 cm")
      .max(230, "Height must be at most 230 cm"),
    // Same bounds as weightSchema in lib/validation/vitals.ts — same
    // physical quantity, same platform. Optional: falls back to the
    // patient's most recent logged vitals weight if omitted.
    weight_kg: z.coerce
      .number()
      .min(20, "Weight must be at least 20 kg")
      .max(300, "Weight must be at most 300 kg")
      .optional(),

    // pmh
    existing_diagnoses: z.array(z.enum(EXISTING_DIAGNOSES)),
    existing_diagnoses_other_detail: z.string().trim().max(300).optional(),

    // meds
    current_medications: z.string().trim().max(500).optional(),

    // vaccination
    hpv_vaccinated: z.coerce.boolean(),
    other_vaccines_detail: z.string().trim().max(300).optional(),

    // screening_history — captured per the spec's field-mapping requirement,
    // but not yet used by the rules engine (ambiguous which condition an
    // unspecified abnormal result maps to).
    prior_abnormal_result: z.coerce.boolean(),
  })
  .superRefine((data, ctx) => {
    if (data.smoking_status === "current" && !data.cigarettes_per_day) {
      ctx.addIssue({
        code: "custom",
        path: ["cigarettes_per_day"],
        message: "Tell us roughly how many cigarettes a day",
      });
    }
    if (data.family_cancer_types.includes("other") && !data.family_cancer_other_detail) {
      ctx.addIssue({
        code: "custom",
        path: ["family_cancer_other_detail"],
        message: "Tell us which cancer type",
      });
    }
    if (data.existing_diagnoses.includes("other") && !data.existing_diagnoses_other_detail) {
      ctx.addIssue({
        code: "custom",
        path: ["existing_diagnoses_other_detail"],
        message: "Tell us which diagnosis",
      });
    }
  });

export type RiskAssessmentInput = z.infer<typeof riskAssessmentSchema>;

/** Which risk_assessment_responses.category each field belongs to. */
export const QUESTION_CATEGORY: Record<
  keyof RiskAssessmentInput,
  Enums<"risk_assessment_category">
> = {
  family_diabetes: "family_history",
  family_hypertension: "family_history",
  family_heart_disease: "family_history",
  family_sickle_cell: "family_history",
  family_cancer_types: "family_history",
  family_cancer_other_detail: "family_history",
  smoking_status: "lifestyle",
  cigarettes_per_day: "lifestyle",
  alcohol_use: "lifestyle",
  exercise_days_per_week: "lifestyle",
  exercise_minutes_per_session: "lifestyle",
  diet_pattern: "lifestyle",
  sleep_hours: "lifestyle",
  stress_level: "lifestyle",
  height_cm: "lifestyle",
  weight_kg: "lifestyle",
  existing_diagnoses: "pmh",
  existing_diagnoses_other_detail: "pmh",
  current_medications: "meds",
  hpv_vaccinated: "vaccination",
  other_vaccines_detail: "vaccination",
  prior_abnormal_result: "screening_history",
};
