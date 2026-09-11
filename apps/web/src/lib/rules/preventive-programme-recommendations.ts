import type { Enums } from "@tarragon/shared";
import type { RiskTier } from "./risk-scoring";

export type { RiskTier } from "./risk-scoring";

/** Minimal risk input the engine needs — decoupled from ComputedRiskScore so
 * callers can feed it either the freshly computed scores or persisted
 * prevention_risk_scores rows (mapping very_high → high). */
export interface ProgrammeRiskInput {
  condition: string;
  tier: RiskTier;
}

/**
 * Rule-based mapping from a patient's computed prevention risk tiers + basic
 * demographics to *recommended* preventive programmes (the prevention tracks in
 * public.preventive_programmes). Pure — no DB access — so the enrolment card can
 * re-run it on every render as risk/profile change.
 *
 * A programme code is only recommended when there's a defensible reason: a
 * cardiometabolic risk tier is reached, or the patient's age/sex fits an
 * age-appropriate screening track. The Annual Health Check is recommended for
 * everyone. These are *suggestions* the patient may act on by enrolling — never
 * a clinician-signed plan, and enrolment itself is always the patient's (or
 * staff's) explicit choice.
 */

export type PreventiveProgrammeCode =
  | "annual_health_check"
  | "cardiometabolic_prevention"
  | "womens_health"
  | "mens_health"
  | "cancer_screening";

export interface PreventiveProgrammeProfile {
  sex: Enums<"sex"> | null;
  ageYears: number | null;
}

export interface PreventiveProgrammeRecommendation {
  code: PreventiveProgrammeCode;
  rationale: string;
}

/** prevention_risk_scores.tier is risk_level (has very_high/unknown); this
 * engine only works in three tiers. very_high collapses into high; unknown
 * collapses into low — a recommendation driven by absent data should never
 * read as more urgent than one driven by an actual low reading. Shared
 * between the client-side "Recommended for you" badge
 * (preventive-programmes.tsx) and the server-side auto-enrolment in
 * submitRiskAssessment (patient/actions.ts) so both apply the same rule. */
export function toRiskTier(tier: Enums<"risk_level">): RiskTier {
  if (tier === "very_high") return "high";
  if (tier === "unknown") return "low";
  return tier;
}

const TIER_RANK: Record<RiskTier, number> = { low: 0, moderate: 1, high: 2 };

function anyTierMeets(
  tierByCondition: Map<string, RiskTier>,
  conditions: string[],
  minTier: RiskTier
): boolean {
  return conditions.some((condition) => {
    const tier = tierByCondition.get(condition);
    return tier !== undefined && TIER_RANK[tier] >= TIER_RANK[minTier];
  });
}

export function computePreventiveProgrammeRecommendations(
  scores: ReadonlyArray<ProgrammeRiskInput>,
  profile: PreventiveProgrammeProfile
): PreventiveProgrammeRecommendation[] {
  const tierByCondition = new Map<string, RiskTier>(
    scores.map((score) => [score.condition, score.tier])
  );
  const recommendations: PreventiveProgrammeRecommendation[] = [];

  // Annual Health Check — universal.
  recommendations.push({
    code: "annual_health_check",
    rationale: "A yearly health check is recommended for everyone.",
  });

  // Cardiometabolic — any of BP / diabetes / CVD at moderate or higher.
  if (anyTierMeets(tierByCondition, ["hypertension", "diabetes", "cvd"], "moderate")) {
    recommendations.push({
      code: "cardiometabolic_prevention",
      rationale: "Your answers put you at higher cardiometabolic risk.",
    });
  }

  const age = profile.ageYears;

  // Women's health — age-appropriate reproductive/breast/cervical screening.
  if (profile.sex === "female" && age !== null && age >= 21) {
    recommendations.push({
      code: "womens_health",
      rationale: "Age-appropriate cervical, breast and reproductive-health screening.",
    });
  }

  // Men's health — prostate + cardiometabolic screening from 40.
  if (profile.sex === "male" && age !== null && age >= 40) {
    recommendations.push({
      code: "mens_health",
      rationale: "Age-appropriate prostate and cardiometabolic screening for men.",
    });
  }

  // Cancer screening — age-driven (bowel screening starts mid-40s).
  if (age !== null && age >= 45) {
    recommendations.push({
      code: "cancer_screening",
      rationale: "You're in the age range for routine cancer screening.",
    });
  }

  return recommendations;
}
