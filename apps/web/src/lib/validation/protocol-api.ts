import { z } from "zod";

/**
 * Body schemas for the three stateless Protocol API classifiers
 * (docs/INTEGRATIONS_API.md § Protocol API). Every field mirrors the pure
 * lib/rules engine's own input shape exactly — the route never reshapes or
 * reinterprets a partner's data before handing it to the same
 * validated function this platform's own patients run through.
 */

export const bpTriageSchema = z.object({
  systolic: z.number().int().min(60).max(260),
  diastolic: z.number().int().min(30).max(180),
});
export type BpTriageInput = z.infer<typeof bpTriageSchema>;

export const diabetesRiskSchema = z.object({
  age_years: z.number().int().min(1).max(120),
  bmi: z.number().min(10).max(80),
  waist_cm: z.number().min(40).max(200),
  sex: z.enum(["male", "female"]),
  physically_active: z.boolean(),
  eats_vegetables_fruit_daily: z.boolean(),
  on_bp_medication: z.boolean(),
  history_of_high_glucose: z.boolean(),
  family_history: z.enum(["none", "second_degree", "first_degree"]),
});
export type DiabetesRiskInput = z.infer<typeof diabetesRiskSchema>;

const cardiovascularProfileSchema = z
  .object({
    established_ascvd: z.boolean(),
    prior_mi: z.boolean(),
    prior_stroke_tia: z.boolean(),
    prior_pad: z.boolean(),
    prior_revascularisation: z.boolean(),
    familial_hypercholesterolaemia: z.boolean(),
  })
  .nullable()
  .default(null);

export const cvRiskSchema = z.object({
  age: z.number().int().min(1).max(120).nullable().default(null),
  sex: z.enum(["male", "female"]).nullable().default(null),
  ldl_mg_dl: z.number().min(0).max(600).nullable().default(null),
  non_hdl_mg_dl: z.number().min(0).max(600).nullable().default(null),
  previous_non_hdl_mg_dl: z.number().min(0).max(600).nullable().default(null),
  ten_year_risk_pct: z.number().min(0).max(100).nullable().default(null),
  ten_year_risk_level: z.enum(["low", "moderate", "high", "very_high"]).nullable().default(null),
  diabetes: z.boolean().default(false),
  cv_profile: cardiovascularProfileSchema,
  on_lipid_lowering_therapy: z.boolean().default(false),
});
export type CvRiskApiInput = z.infer<typeof cvRiskSchema>;
