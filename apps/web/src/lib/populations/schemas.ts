import { z } from "zod";

/**
 * Population Health Management Engine (spec §41) — the typed filter
 * vocabulary a population_definitions.filters jsonb value is validated
 * against, mirroring the read side get_population_members() implements in
 * SQL (20260829121205_population_health_engine.sql). Every key is optional;
 * an absent/empty array means "no constraint on this axis" both here and in
 * the database function — this schema and that function must agree on the
 * key names or a saved filter silently stops matching anything.
 */

export const CARE_PLAN_CONDITIONS = [
  "hypertension",
  "diabetes",
  "obesity",
  "ckd",
  "cardiovascular",
  "asthma",
  "copd",
  "heart_failure",
  "other",
] as const;

export const PREVENTION_CONDITIONS = [
  "hypertension",
  "diabetes",
  "cvd",
  "ckd",
  "breast_ca",
  "cervical_ca",
  "colorectal_ca",
  "prostate_ca",
  "asthma_copd",
  "mental_wellbeing",
  "other",
] as const;

export const RISK_LEVELS = ["low", "moderate", "high", "very_high", "unknown"] as const;

export const CONTROL_STATUSES = ["controlled", "uncontrolled", "unknown"] as const;

/** patient_care_gaps.gap_type values — a derived text column, not a DB enum, so this list is the source of truth on the app side. */
export const CARE_GAP_TYPES = [
  "overdue_screening",
  "stale_monitoring",
  "unactioned_abnormal",
  "awaiting_result",
  "repeated_no_show",
] as const;

export const ENGAGEMENT_BANDS = ["active", "declining", "disengaged"] as const;

export const CARE_PLAN_CONDITION_LABEL: Record<(typeof CARE_PLAN_CONDITIONS)[number], string> = {
  hypertension: "Hypertension",
  diabetes: "Diabetes",
  obesity: "Obesity",
  ckd: "Chronic kidney disease",
  cardiovascular: "Cardiovascular disease",
  asthma: "Asthma",
  copd: "COPD",
  heart_failure: "Heart failure",
  other: "Other",
};

export const PREVENTION_CONDITION_LABEL: Record<(typeof PREVENTION_CONDITIONS)[number], string> = {
  hypertension: "Hypertension (screening)",
  diabetes: "Diabetes (screening)",
  cvd: "Cardiovascular disease (screening)",
  ckd: "Chronic kidney disease (screening)",
  breast_ca: "Breast cancer",
  cervical_ca: "Cervical cancer",
  colorectal_ca: "Colorectal cancer",
  prostate_ca: "Prostate cancer",
  asthma_copd: "Asthma / COPD",
  mental_wellbeing: "Mental wellbeing",
  other: "Other",
};

export const RISK_LEVEL_LABEL: Record<(typeof RISK_LEVELS)[number], string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  very_high: "Very high",
  unknown: "Unknown",
};

export const CARE_GAP_TYPE_LABEL: Record<(typeof CARE_GAP_TYPES)[number], string> = {
  overdue_screening: "Overdue screening",
  stale_monitoring: "No recent monitoring",
  unactioned_abnormal: "Unactioned abnormal result",
  awaiting_result: "Awaiting self-arranged result",
  repeated_no_show: "Repeated no-show",
};

export const CONTROL_STATUS_LABEL: Record<(typeof CONTROL_STATUSES)[number], string> = {
  controlled: "Controlled",
  uncontrolled: "Uncontrolled",
  unknown: "Unknown",
};

export const ENGAGEMENT_BAND_LABEL: Record<(typeof ENGAGEMENT_BANDS)[number], string> = {
  active: "Active (last 7 days)",
  declining: "Declining (8–30 days)",
  disengaged: "Disengaged (30+ days / never)",
};

export const populationFiltersSchema = z
  .object({
    conditions: z.array(z.enum(CARE_PLAN_CONDITIONS)).optional(),
    prevention_conditions: z.array(z.enum(PREVENTION_CONDITIONS)).optional(),
    risk_levels: z.array(z.enum(RISK_LEVELS)).optional(),
    care_gap_types: z.array(z.enum(CARE_GAP_TYPES)).optional(),
    control_status: z.array(z.enum(CONTROL_STATUSES)).optional(),
    engagement: z.array(z.enum(ENGAGEMENT_BANDS)).optional(),
    min_age: z.number().int().min(0).max(120).optional(),
    max_age: z.number().int().min(0).max(120).optional(),
    sex: z.enum(["male", "female"]).optional(),
    states: z.array(z.string().min(1)).optional(),
    pregnant_only: z.boolean().optional(),
  })
  .strict();

export type PopulationFilters = z.infer<typeof populationFiltersSchema>;

const countedBucket = <T extends z.ZodTypeAny>(keyField: string, keySchema: T) =>
  z.array(z.object({ [keyField]: keySchema, patients: z.number() }).passthrough());

export const populationSummarySchema = z.object({
  total_members: z.number(),
  risk_distribution: countedBucket("risk_level", z.string()),
  control_status: countedBucket("status", z.string()),
  care_gaps: countedBucket("gap_type", z.string()),
  engagement: countedBucket("band", z.string()),
});
export type PopulationSummary = z.infer<typeof populationSummarySchema>;

export const populationOutcomesSchema = z.object({
  disease_control: countedBucket("status", z.string()),
  engagement: countedBucket("band", z.string()),
  screening_completion_rate: z.number().nullable(),
  screening_completed: z.number(),
  screening_total: z.number(),
  medication_adherence_rate: z.number().nullable(),
  medication_checkins_taken: z.number(),
  medication_checkins_total: z.number(),
  care_plan_completion_rate: z.number().nullable(),
  care_plans_completed: z.number(),
  care_plans_total: z.number(),
});
export type PopulationOutcomes = z.infer<typeof populationOutcomesSchema>;

export const campaignEffectivenessSchema = z.object({
  invited: z.number(),
  joined: z.number(),
  completed: z.number(),
  declined: z.number(),
  total_enrolled: z.number(),
  completion_rate: z.number().nullable(),
  population_size: z.number().nullable(),
});
export type CampaignEffectiveness = z.infer<typeof campaignEffectivenessSchema>;
