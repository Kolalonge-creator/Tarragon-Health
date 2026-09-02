import { z } from "zod";

/**
 * Fertility self-assessment (spec §47.9) — a short structured intake, scored
 * deterministically server-side by apps/web/src/lib/rules/fertility-assessment.ts.
 *
 * patient_age_years is deliberately NOT collected here: it's read
 * server-side from profiles.date_of_birth so a client can never spoof the
 * age used by the specialist-referral threshold. menstrual_cycle_regular is
 * optional — it's only meaningful for someone with a uterus, so the form can
 * skip the question entirely rather than force an answer that doesn't apply.
 */
export const KNOWN_RISK_FACTORS = [
  "pcos",
  "endometriosis",
  "prior_pelvic_surgery",
  "irregular_cycles",
  "low_sperm_count_history",
  "none",
] as const;

export type KnownRiskFactor = (typeof KNOWN_RISK_FACTORS)[number];

export const KNOWN_RISK_FACTOR_LABEL: Record<KnownRiskFactor, string> = {
  pcos: "PCOS (polycystic ovary syndrome)",
  endometriosis: "Endometriosis",
  prior_pelvic_surgery: "Prior pelvic surgery",
  irregular_cycles: "Irregular menstrual cycles",
  low_sperm_count_history: "History of low sperm count",
  none: "None of these",
};

export const fertilityAssessmentSchema = z.object({
  trying_duration_months: z.coerce
    .number()
    .int()
    .min(0, "Enter 0 or more months")
    .max(120, "Enter 120 months or fewer"),
  // A plain "true"/"false" radio pair; if neither is selected, the field is
  // absent from the form entirely and stays undefined (never forced).
  menstrual_cycle_regular: z.preprocess((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return undefined;
  }, z.boolean().optional()),
  known_risk_factors: z.array(z.enum(KNOWN_RISK_FACTORS)).default([]),
});

export type FertilityAssessmentInput = z.infer<typeof fertilityAssessmentSchema>;
