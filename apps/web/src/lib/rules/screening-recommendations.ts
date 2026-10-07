import type { Enums, Tables } from "@tarragon/shared";
import type { PreventionCondition, RiskTier } from "./risk-scoring";

export type ScreenTypeRow = Pick<
  Tables<"screen_types">,
  "id" | "code" | "sex_applicability" | "age_from" | "age_to" | "frequency_months" | "is_optional"
>;

export interface ScreeningProfile {
  sex: Enums<"sex"> | null;
  ageYears: number | null;
  /**
   * Self-reported reproductive life stage (reproductive_health_profiles.
   * life_stage) — undefined/null whenever the patient has no profile row on
   * file yet (e.g. straight out of onboarding's general risk assessment,
   * which never asks a women's-health question). Only consulted for the
   * handful of codes in LIFE_STAGE_GATED_SCREENS below; every other screen
   * type's sex/age eligibility is unaffected.
   */
  reproductiveLifeStage?: Enums<"reproductive_life_stage"> | null;
}

export interface ScreeningRecommendation {
  screenTypeId: string;
  screenTypeCode: string;
  dueDate: string;
  /**
   * screen_types.is_optional carried through unchanged — see that column's
   * own comment ("Offered when due, never assumed. The patient opts in
   * rather than finding it already inside their review."). This function
   * still computes a due date for an optional screen type (so a caller can
   * show it as an offer with a real date), it just never implies the caller
   * should auto-insert a screening_schedules row for it — callers that do
   * the auto-scheduling (e.g. actions.ts) must filter this out themselves.
   */
  isOptional: boolean;
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
 * screen_types whose sex+age eligibility alone is presumptuous rather than
 * merely broad. antenatal_booking is 'female'/15-49 with no pregnancy signal
 * of its own in the catalogue — sex+age alone would tell every eligible
 * woman she's "due" for antenatal booking regardless of whether she is
 * pregnant, trying to conceive, or neither. Gated on the same self-reported
 * life stage cycle-nudges.ts already uses for its own (separately-surfaced)
 * antenatal nudge. A code with no entry here is unaffected — this only ever
 * narrows the small set of codes listed, never the general engine.
 */
const LIFE_STAGE_GATED_SCREENS: Partial<Record<string, ReadonlyArray<Enums<"reproductive_life_stage">>>> = {
  antenatal_booking: ["pregnant"],
};

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

    const requiredLifeStages = LIFE_STAGE_GATED_SCREENS[screenType.code];
    if (requiredLifeStages && !requiredLifeStages.includes(profile.reproductiveLifeStage ?? "not_applicable")) {
      continue;
    }

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
        isOptional: screenType.is_optional,
      });
    } else {
      recommendations.push({
        screenTypeId: screenType.id,
        screenTypeCode: screenType.code,
        dueDate: todayISODate(today),
        isOptional: screenType.is_optional,
      });
    }
  }

  return recommendations;
}

export interface ScreeningScheduleHistoryRow {
  screen_type_id: string;
  status: string;
  due_date: string;
}

/**
 * "Most recent completed due_date per screen type" — the exact map shape
 * computeScreeningRecommendations's `lastCompletedByScreenTypeId` parameter
 * expects. Factored out here (this function already owns that parameter's
 * type contract) so every caller building it from a screening_schedules
 * result set shares one implementation rather than re-deriving the same
 * "keep the latest due_date where status === 'completed'" logic by hand —
 * actions.ts's submitRiskAssessment and screening.ts's
 * useOptionalScreeningOffers both call this instead of looping themselves.
 */
export function buildLastCompletedByScreenTypeId(
  schedules: ScreeningScheduleHistoryRow[]
): Map<string, string> {
  const lastCompletedByScreenTypeId = new Map<string, string>();
  for (const row of schedules) {
    if (row.status !== "completed") continue;
    const latest = lastCompletedByScreenTypeId.get(row.screen_type_id);
    if (!latest || row.due_date > latest) {
      lastCompletedByScreenTypeId.set(row.screen_type_id, row.due_date);
    }
  }
  return lastCompletedByScreenTypeId;
}
