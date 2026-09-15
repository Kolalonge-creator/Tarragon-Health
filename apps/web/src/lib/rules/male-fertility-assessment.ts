/**
 * Male fertility self-assessment (Men's Health §45.6). Pure — no DB access.
 *
 * Unlike the ED/prostate instruments, this isn't a validated symptom score —
 * it is a short structured intake (how long the couple has been trying,
 * known risk factors, whether a semen analysis has already been done) that
 * decides whether a semen analysis is a reasonable next step. Mirrors the
 * threshold already used in the 'women-fertility-basics' health-education
 * article ("a year without success... six months if a risk factor applies")
 * adapted to the male-factor context.
 */

export type MaleFertilityRiskFactor =
  | "heat_exposure"
  | "smoking"
  | "heavy_alcohol"
  | "prior_urological_surgery"
  | "known_varicocele"
  | "relevant_medical_condition";

export type PriorSemenAnalysis = "none" | "normal" | "abnormal" | "pending";

export interface MaleFertilityAssessmentInput {
  tryingToConceiveMonths: number;
  riskFactors: MaleFertilityRiskFactor[];
  priorSemenAnalysis: PriorSemenAnalysis;
}

export interface MaleFertilityAssessmentResult {
  /**
   * A semen analysis is reasonable at 12 months of trying regardless of risk
   * factors, or at 6 months when a known risk factor is already present —
   * never suggested again once a result is already on file (normal or
   * abnormal) or already pending.
   */
  semenAnalysisSuggested: boolean;
}

export function assessMaleFertility(
  input: MaleFertilityAssessmentInput
): MaleFertilityAssessmentResult {
  if (input.priorSemenAnalysis !== "none") {
    return { semenAnalysisSuggested: false };
  }
  const { tryingToConceiveMonths, riskFactors } = input;
  const semenAnalysisSuggested =
    tryingToConceiveMonths >= 12 || (tryingToConceiveMonths >= 6 && riskFactors.length > 0);
  return { semenAnalysisSuggested };
}

export const MALE_FERTILITY_RISK_FACTOR_LABEL: Record<MaleFertilityRiskFactor, string> = {
  heat_exposure: "Frequent hot baths, saunas, or a laptop on the lap",
  smoking: "Smoking",
  heavy_alcohol: "Heavy alcohol use",
  prior_urological_surgery: "Previous urological surgery",
  known_varicocele: "Known varicocele",
  relevant_medical_condition: "A relevant medical condition (e.g. diabetes, thyroid issue)",
};
