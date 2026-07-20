import { z } from "zod";
import type { CvRiskConfig } from "@/lib/rules/cv-risk";

/**
 * Form/validation schema for editing the CV-risk configuration values. Each
 * numeric threshold/target is a positive number; these become a new
 * cv_risk_config version (unsigned draft) that a Clinical Director then signs.
 * Keeping the shape structured (not free JSON) prevents a malformed config
 * ever reaching the engine.
 */
const mgdl = z.coerce.number().positive().max(1000);
const pct = z.coerce.number().positive().max(100);
const months = z.coerce.number().int().positive().max(60);
const age = z.coerce.number().int().min(0).max(120);

export const cvRiskConfigFormSchema = z.object({
  secondary_ldl_max: mgdl,
  secondary_non_hdl_max: mgdl,
  primary_high_ldl_max: mgdl,
  primary_high_non_hdl_max: mgdl,
  primary_standard_ldl_max: mgdl,
  primary_standard_non_hdl_max: mgdl,
  diabetes_min_age: age,
  primary_10yr_risk_pct: pct,
  very_high_ldl: mgdl,
  very_high_non_hdl: mgdl,
  worsening_trend_pct: pct,
  chronic_lipid_monitoring_months: months,
  population_note: z.string().min(1).max(1000),
});

export type CvRiskConfigFormValues = z.infer<typeof cvRiskConfigFormSchema>;

/** Assemble the full config jsonb the engine reads from validated form values. */
export function buildCvRiskConfig(values: CvRiskConfigFormValues): CvRiskConfig {
  return {
    unit: "mg/dL",
    population_note: values.population_note,
    targets_mg_dl: {
      secondary: { ldl_max: values.secondary_ldl_max, non_hdl_max: values.secondary_non_hdl_max },
      primary_high: {
        ldl_max: values.primary_high_ldl_max,
        non_hdl_max: values.primary_high_non_hdl_max,
      },
      primary_standard: {
        ldl_max: values.primary_standard_ldl_max,
        non_hdl_max: values.primary_standard_non_hdl_max,
      },
    },
    statin_eligibility: {
      secondary_recommend: true,
      diabetes_min_age: values.diabetes_min_age,
      primary_10yr_risk_pct: values.primary_10yr_risk_pct,
    },
    escalation_mg_dl: {
      very_high_ldl: values.very_high_ldl,
      very_high_non_hdl: values.very_high_non_hdl,
      worsening_trend_pct: values.worsening_trend_pct,
    },
    chronic_lipid_monitoring_months: values.chronic_lipid_monitoring_months,
  };
}

/** Flatten a stored config back into form defaults (prefill the editor). */
export function configToFormValues(config: CvRiskConfig): CvRiskConfigFormValues {
  return {
    secondary_ldl_max: config.targets_mg_dl.secondary.ldl_max,
    secondary_non_hdl_max: config.targets_mg_dl.secondary.non_hdl_max,
    primary_high_ldl_max: config.targets_mg_dl.primary_high.ldl_max,
    primary_high_non_hdl_max: config.targets_mg_dl.primary_high.non_hdl_max,
    primary_standard_ldl_max: config.targets_mg_dl.primary_standard.ldl_max,
    primary_standard_non_hdl_max: config.targets_mg_dl.primary_standard.non_hdl_max,
    diabetes_min_age: config.statin_eligibility.diabetes_min_age,
    primary_10yr_risk_pct: config.statin_eligibility.primary_10yr_risk_pct,
    very_high_ldl: config.escalation_mg_dl.very_high_ldl,
    very_high_non_hdl: config.escalation_mg_dl.very_high_non_hdl,
    worsening_trend_pct: config.escalation_mg_dl.worsening_trend_pct,
    chronic_lipid_monitoring_months: config.chronic_lipid_monitoring_months,
    population_note: config.population_note,
  };
}
