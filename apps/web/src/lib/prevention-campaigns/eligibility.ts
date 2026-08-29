import { evaluatePredicate, type Predicate, type PredicateContext } from "@/lib/rules/predicate";
import type { Enums } from "@tarragon/shared";

/**
 * Whether a patient is eligible for a prevention campaign (spec §2.16),
 * evaluated against a context built entirely from data the patient can
 * already see about themselves — their own profile fields and their own
 * current prevention_risk_scores tiers. Reuses the same predicate DSL as
 * the risk questionnaire engine (lib/rules/predicate.ts) rather than a
 * second bespoke rules format.
 */
export interface CampaignEligibilityProfile {
  sex: Enums<"sex"> | null;
  ageYears: number | null;
}

export function buildCampaignEligibilityContext(
  profile: CampaignEligibilityProfile,
  latestTierByCondition: Map<string, Enums<"risk_level">>,
): PredicateContext {
  const context: PredicateContext = {
    sex: profile.sex,
    ageYears: profile.ageYears,
  };
  for (const [condition, tier] of latestTierByCondition) {
    context[`${condition}_tier`] = tier;
  }
  return context;
}

export function isEligibleForCampaign(rule: Predicate, context: PredicateContext): boolean {
  return evaluatePredicate(rule, context);
}
