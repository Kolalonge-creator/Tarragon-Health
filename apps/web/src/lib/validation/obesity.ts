import { z } from "zod";

/**
 * Obesity pathway (TH-CP-OB-001) form validation + the shared vocabularies the
 * clinician UI and server actions both use. Objective classification is
 * computed server-side by the classifier (lib/obesity/classify.ts) — the forms
 * only carry raw measurements + the doctor's own judgements/selections.
 */

/** §19 obesity-related complications the doctor screens for. */
export const OBESITY_COMPLICATIONS = [
  "type2_diabetes",
  "prediabetes",
  "hypertension",
  "dyslipidaemia",
  "nafld",
  "osa",
  "osteoarthritis",
  "pcos",
  "cardiovascular_disease",
  "depression",
] as const;
export type ObesityComplication = (typeof OBESITY_COMPLICATIONS)[number];

export const OBESITY_COMPLICATION_LABELS: Record<ObesityComplication, string> = {
  type2_diabetes: "Type 2 diabetes",
  prediabetes: "Prediabetes",
  hypertension: "Hypertension",
  dyslipidaemia: "Dyslipidaemia",
  nafld: "Fatty liver (NAFLD)",
  osa: "Obstructive sleep apnoea",
  osteoarthritis: "Osteoarthritis / joint pain",
  pcos: "PCOS",
  cardiovascular_disease: "Cardiovascular disease",
  depression: "Depression",
};

/** §6.4 secondary / contributing causes to consider. */
export const OBESITY_SECONDARY_CAUSES = [
  "hypothyroidism",
  "cushings",
  "pcos",
  "drug_induced",
  "hypothalamic_monogenic",
] as const;
export type ObesitySecondaryCause = (typeof OBESITY_SECONDARY_CAUSES)[number];

export const OBESITY_SECONDARY_CAUSE_LABELS: Record<ObesitySecondaryCause, string> = {
  hypothyroidism: "Hypothyroidism",
  cushings: "Cushing's syndrome",
  pcos: "PCOS",
  drug_induced: "Drug-induced (steroids, some psych meds, insulin…)",
  hypothalamic_monogenic: "Hypothalamic / monogenic (rare)",
};

/** §18.1 disordered-eating behaviours the ED screen captures. */
export const ED_DISORDERED_BEHAVIOURS = [
  "binge",
  "purging",
  "restriction",
  "driven_exercise",
  "night_eating",
] as const;
export type EdDisorderedBehaviour = (typeof ED_DISORDERED_BEHAVIOURS)[number];

export const ED_DISORDERED_BEHAVIOUR_LABELS: Record<EdDisorderedBehaviour, string> = {
  binge: "Binge eating with loss of control",
  purging: "Self-induced vomiting / laxative / diuretic misuse",
  restriction: "Extreme restriction or fasting",
  driven_exercise: "Driven, compulsive exercise",
  night_eating: "Night eating",
};

/** §14.1 bariatric referral criteria keys. */
export const BARIATRIC_CRITERIA = [
  "bmi_ge_40",
  "bmi_ge_35_with_complication",
  "bmi_30_34_uncontrolled_t2dm",
] as const;
export type BariatricCriterion = (typeof BARIATRIC_CRITERIA)[number];

const numeric = (min: number, max: number, label: string) =>
  z.coerce.number().min(min, `${label} looks too low`).max(max, `${label} looks too high`);

export const obesityAssessmentSchema = z.object({
  height_cm: numeric(50, 272, "Height"),
  weight_kg: numeric(20, 500, "Weight"),
  waist_cm: z.coerce.number().min(30).max(250).optional(),
  clinical_status: z.enum(["preclinical", "clinical"]).optional(),
  eoss_stage: z.coerce.number().int().min(0).max(4).optional(),
  functional_limitation: z.coerce.boolean().optional(),
  complications: z.array(z.enum(OBESITY_COMPLICATIONS)).default([]),
  secondary_causes: z.array(z.enum(OBESITY_SECONDARY_CAUSES)).default([]),
  notes: z.string().trim().max(2000).optional(),
});
export type ObesityAssessmentInput = z.infer<typeof obesityAssessmentSchema>;

export const obesityEdScreenSchema = z.object({
  scoff_sick: z.coerce.boolean().optional(),
  scoff_control: z.coerce.boolean().optional(),
  scoff_one_stone: z.coerce.boolean().optional(),
  scoff_fat: z.coerce.boolean().optional(),
  scoff_food_dominates: z.coerce.boolean().optional(),
  self_harm_risk: z.coerce.boolean().optional(),
  low_mood: z.coerce.boolean().optional(),
  disordered_behaviours: z.array(z.enum(ED_DISORDERED_BEHAVIOURS)).default([]),
  notes: z.string().trim().max(2000).optional(),
});
export type ObesityEdScreenInput = z.infer<typeof obesityEdScreenSchema>;

export const bariatricReferralSchema = z.object({
  has_obesity_complication: z.coerce.boolean().optional(),
  has_uncontrolled_t2dm: z.coerce.boolean().optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type BariatricReferralInput = z.infer<typeof bariatricReferralSchema>;
