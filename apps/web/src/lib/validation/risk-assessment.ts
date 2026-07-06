import { z } from "zod";
import type { Enums } from "@tarragon/shared";

export const SMOKING_STATUSES = ["never", "former", "current"] as const;
export const ALCOHOL_USES = ["none", "moderate", "heavy"] as const;
export const EXERCISE_FREQUENCIES = ["none", "1_2_per_week", "3_plus_per_week"] as const;
export const SLEEP_QUALITIES = ["poor", "fair", "good"] as const;
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
] as const;

/**
 * The full risk assessment questionnaire (spec §3.2). Every question maps to
 * a stored, structured field — never free text — so it can drive the rules
 * engine (apps/web/src/lib/rules/risk-scoring.ts). `current_medications` is
 * the one deliberate exception (spec: "free text + structured tags").
 */
export const riskAssessmentSchema = z.object({
  // family_history
  family_diabetes: z.coerce.boolean(),
  family_hypertension: z.coerce.boolean(),
  family_heart_disease: z.coerce.boolean(),
  family_sickle_cell: z.coerce.boolean(),
  family_cancer_types: z.array(z.enum(CANCER_TYPES)),

  // lifestyle
  smoking_status: z.enum(SMOKING_STATUSES),
  alcohol_use: z.enum(ALCOHOL_USES),
  exercise_frequency: z.enum(EXERCISE_FREQUENCIES),
  diet_pattern: z.array(z.enum(DIET_TAGS)),
  sleep_quality: z.enum(SLEEP_QUALITIES),
  stress_level: z.enum(STRESS_LEVELS),
  // Feeds BMI alongside the patient's most recent vitals_readings.weight_kg —
  // there is no height column anywhere else in the schema.
  height_cm: z.coerce
    .number()
    .min(100, "Height must be at least 100 cm")
    .max(230, "Height must be at most 230 cm"),

  // pmh
  existing_diagnoses: z.array(z.enum(EXISTING_DIAGNOSES)),

  // meds
  current_medications: z.string().trim().max(500).optional(),

  // vaccination
  hpv_vaccinated: z.coerce.boolean(),

  // screening_history — captured per the spec's field-mapping requirement,
  // but not yet used by the rules engine (ambiguous which condition an
  // unspecified abnormal result maps to).
  prior_abnormal_result: z.coerce.boolean(),
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
  smoking_status: "lifestyle",
  alcohol_use: "lifestyle",
  exercise_frequency: "lifestyle",
  diet_pattern: "lifestyle",
  sleep_quality: "lifestyle",
  stress_level: "lifestyle",
  height_cm: "lifestyle",
  existing_diagnoses: "pmh",
  current_medications: "meds",
  hpv_vaccinated: "vaccination",
  prior_abnormal_result: "screening_history",
};
