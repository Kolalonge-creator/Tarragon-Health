import { getProposedConfig } from "../proposed-config";

/**
 * Child acute malnutrition routing (CMO pack A7, PROPOSED, NOT SIGNED). Mirrors private.classify_nutrition in the database, which is the
 * authority and writes the class on the row. This copy drives what the screen says, and the parity table below is shared with the SQL proof.
 */
export interface NutritionRules {
  readonly sam_muac_mm_lt: number;
  readonly sam_wfh_z_lt: number;
  readonly sam_oedema: boolean;
  readonly sam_review_within_hours: number;
  readonly mam_muac_mm_lt: number;
  readonly mam_wfh_z_lt: number;
  readonly mam_review_within_days: number;
  readonly muac_min_age_months: number;
  readonly muac_max_age_months: number;
  readonly stunting_hfa_z_lt: number;
  readonly underweight_wfa_z_lt: number;
}

export type NutritionClass = "severe_acute" | "moderate_acute" | "none";
const DAYS_PER_MONTH = 30.4375;

export function currentNutritionRules(): { rules: NutritionRules; version: number } {
  const c = getProposedConfig<Record<string, number | boolean>>("maternal_child.growth.nutrition_routing");
  return { rules: c.value as unknown as NutritionRules, version: c.version };
}

export interface NutritionInput {
  readonly ageDays: number;
  readonly muacMm: number | null;
  readonly weightForHeightZ: number | null;
  readonly oedema: boolean;
}

export function classifyNutrition(i: NutritionInput, rules: NutritionRules = currentNutritionRules().rules): NutritionClass {
  const months = i.ageDays / DAYS_PER_MONTH;
  const muacOk = i.muacMm !== null && months >= rules.muac_min_age_months && months < rules.muac_max_age_months;
  if ((i.oedema && rules.sam_oedema) || (muacOk && (i.muacMm as number) < rules.sam_muac_mm_lt) || (i.weightForHeightZ !== null && i.weightForHeightZ < rules.sam_wfh_z_lt)) {
    return "severe_acute";
  }
  if ((muacOk && (i.muacMm as number) < rules.mam_muac_mm_lt) || (i.weightForHeightZ !== null && i.weightForHeightZ < rules.mam_wfh_z_lt)) {
    return "moderate_acute";
  }
  return "none";
}

/** Which message the screen shows. When the guard is closed the class is stored but nothing is routed, and the screen says so plainly. */
export function nutritionCopyKey(c: NutritionClass | null, followUpOpen: boolean):
  | "mch.growth.nutrition_severe" | "mch.growth.nutrition_moderate" | "mch.growth.not_followed_up" | null {
  if (c === null || c === "none") return null;
  if (!followUpOpen) return "mch.growth.not_followed_up";
  return c === "severe_acute" ? "mch.growth.nutrition_severe" : "mch.growth.nutrition_moderate";
}
