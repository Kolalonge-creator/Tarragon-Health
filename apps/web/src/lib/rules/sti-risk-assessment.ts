import type { StiRiskCheckInput } from "@/lib/validation/sti-risk-check";

/**
 * Deterministic STI risk/symptom-check scoring (spec §47.3). Pure — no DB
 * access — so it's unit-testable and safe to re-run on the client for a live
 * preview; the server action is the only writer of the result, exactly the
 * tamper-resistance mental-health-screening.ts gives PHQ-9/GAD-7/AUDIT-C.
 *
 * Never a diagnosis, never itself an escalation — just a triage signal that
 * decides which self-bookable screens to suggest and, when it's high or a
 * symptom was reported, that a clinician_alerts row should be raised.
 *
 * Points (only when sexually_active_12mo is true — otherwise short-circuits
 * to low/no symptomFlag/no recommendations):
 *   new_partner_3mo                +1
 *   partner_count_12mo "2_4"       +1
 *   partner_count_12mo "5_plus"    +2
 *   condom_use "never"             +1
 *   prior_sti_diagnosis             +1
 *   partner_diagnosed_sti          +2
 *   any real symptom selected      +3 (and sets symptomFlag)
 *
 * Bands: 0-1 low, 2-3 moderate, 4+ high — but a symptomFlag always forces at
 * least "moderate" (belt-and-suspenders: the +3 symptom contribution already
 * guarantees this under the current point scheme, but the override is kept
 * explicit so a future re-weighting can't silently break the guarantee).
 */

export type StiRiskLevel = "low" | "moderate" | "high";

export interface StiRiskCheckResult {
  riskLevel: StiRiskLevel;
  symptomFlag: boolean;
  recommendedScreenCodes: string[];
}

const MODERATE_SCREEN_CODES = ["hiv", "syphilis", "chlamydia_gonorrhoea"];
const FULL_SCREEN_CODES = ["hiv", "syphilis", "chlamydia_gonorrhoea", "hep_b", "hep_c"];

export function scoreStiRiskCheck(input: StiRiskCheckInput): StiRiskCheckResult {
  if (!input.sexually_active_12mo) {
    return { riskLevel: "low", symptomFlag: false, recommendedScreenCodes: [] };
  }

  let score = 0;
  if (input.new_partner_3mo) score += 1;
  if (input.partner_count_12mo === "2_4") score += 1;
  else if (input.partner_count_12mo === "5_plus") score += 2;
  if (input.condom_use === "never") score += 1;
  if (input.prior_sti_diagnosis) score += 1;
  if (input.partner_diagnosed_sti) score += 2;

  const symptomFlag = input.symptoms.some((symptom) => symptom !== "none");
  if (symptomFlag) score += 3;

  let riskLevel: StiRiskLevel;
  if (score >= 4) riskLevel = "high";
  else if (score >= 2) riskLevel = "moderate";
  else riskLevel = "low";
  if (symptomFlag && riskLevel === "low") riskLevel = "moderate";

  const recommendedScreenCodes =
    riskLevel === "low" ? [] : symptomFlag || riskLevel === "high" ? FULL_SCREEN_CODES : MODERATE_SCREEN_CODES;

  return { riskLevel, symptomFlag, recommendedScreenCodes };
}
