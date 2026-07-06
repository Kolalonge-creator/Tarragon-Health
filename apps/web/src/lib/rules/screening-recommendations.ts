import type { Enums, Tables } from "@tarragon/shared";
import type { PreventionCondition, RiskTier } from "./risk-scoring";

export type ScreenTypeRow = Pick<
  Tables<"screen_types">,
  "id" | "code" | "sex_applicability" | "age_from" | "age_to" | "frequency_months"
>;

export interface ScreeningProfile {
  sex: Enums<"sex"> | null;
  ageYears: number | null;
}

export interface ScreeningRecommendation {
  screenTypeId: string;
  screenTypeCode: string;
  dueDate: string;
}

interface TierEscalationRule {
  screenTypeCode: string;
  condition: PreventionCondition;
  minTier: RiskTier;
  /** Tighter cadence (months) once the tier threshold is met. */
  frequencyMonths?: number;
  /** Earlier starting age once the tier threshold is met. */
  ageFrom?: number;
}

const TIER_RANK: Record<RiskTier, number> = { low: 0, moderate: 1, high: 2 };

/**
 * Tier-driven overrides from V1 spec §6.1 ("Escalation trigger" column).
 * The engine only ever escalates — tightens cadence or lowers the start
 * age — never loosens a screen_types catalogue value, so a tier drop never
 * silently cancels a screening someone is already due for.
 */
const TIER_ESCALATIONS: TierEscalationRule[] = [
  { screenTypeCode: "blood_pressure", condition: "hypertension", minTier: "moderate", frequencyMonths: 12 },
  { screenTypeCode: "hba1c", condition: "diabetes", minTier: "moderate", ageFrom: 25 },
  { screenTypeCode: "lipid_panel", condition: "cvd", minTier: "high", ageFrom: 30 },
];

function tierMeets(tier: RiskTier | undefined, minTier: RiskTier): boolean {
  return tier !== undefined && TIER_RANK[tier] >= TIER_RANK[minTier];
}

function addMonths(isoDate: string, months: number): string {
  const date = new Date(isoDate);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function todayISODate(today: Date): string {
  return today.toISOString().slice(0, 10);
}

/**
 * Computes which screen types a patient is currently due for, and when.
 * Pure — no DB access, so it stays testable and callers can re-run it
 * idempotently (e.g. every time a risk assessment is resubmitted, per V1
 * spec §3.3: "recommendations regenerate ... when ... risk tier changes").
 *
 * `lastCompletedByScreenTypeId` supplies the most recent completed
 * reference date per screen type (undefined if never screened) so cadence
 * counts from the patient's actual history rather than always "today".
 */
export function computeScreeningRecommendations(
  screenTypes: ScreenTypeRow[],
  tiersByCondition: Map<PreventionCondition, RiskTier>,
  profile: ScreeningProfile,
  lastCompletedByScreenTypeId: Map<string, string>,
  today: Date = new Date()
): ScreeningRecommendation[] {
  if (profile.ageYears === null) return [];

  const recommendations: ScreeningRecommendation[] = [];

  for (const screenType of screenTypes) {
    if (screenType.sex_applicability !== "all" && screenType.sex_applicability !== profile.sex) continue;

    let ageFrom = screenType.age_from;
    let frequencyMonths = screenType.frequency_months;

    for (const rule of TIER_ESCALATIONS) {
      if (rule.screenTypeCode !== screenType.code) continue;
      if (!tierMeets(tiersByCondition.get(rule.condition), rule.minTier)) continue;
      if (rule.ageFrom !== undefined && (ageFrom === null || rule.ageFrom < ageFrom)) {
        ageFrom = rule.ageFrom;
      }
      if (rule.frequencyMonths !== undefined && (frequencyMonths === null || rule.frequencyMonths < frequencyMonths)) {
        frequencyMonths = rule.frequencyMonths;
      }
    }

    if (ageFrom !== null && profile.ageYears < ageFrom) continue;
    if (screenType.age_to !== null && profile.ageYears > screenType.age_to) continue;

    const lastCompleted = lastCompletedByScreenTypeId.get(screenType.id);

    if (lastCompleted) {
      if (frequencyMonths === null) continue; // one-off screening, already done
      recommendations.push({
        screenTypeId: screenType.id,
        screenTypeCode: screenType.code,
        dueDate: addMonths(lastCompleted, frequencyMonths),
      });
    } else {
      recommendations.push({
        screenTypeId: screenType.id,
        screenTypeCode: screenType.code,
        dueDate: todayISODate(today),
      });
    }
  }

  return recommendations;
}
