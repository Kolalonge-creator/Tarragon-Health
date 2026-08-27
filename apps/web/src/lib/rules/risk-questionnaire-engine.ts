import { evaluatePredicate, type Predicate, type PredicateContext } from "./predicate";
import type { PreventionCondition } from "./risk-scoring";
import type { Enums } from "@tarragon/shared";

/**
 * Configurable risk questionnaire + scoring engine (spec §2.4/§2.5/§2.18).
 * Reads a signed, versioned config row (public.risk_questionnaire_configs)
 * instead of the hardcoded CONDITION_RULES array in risk-scoring.ts — a
 * clinical admin can add a question, change a threshold, or add a whole new
 * risk domain (e.g. CKD) by authoring and signing a new config version, no
 * deploy required.
 *
 * risk-scoring.ts's computeRiskTiers is NOT deleted — it stays as the
 * fallback engine for as long as no signed risk_questionnaire_configs row
 * is active for an organisation (mirrors how lib/rules/cv-risk.ts config-
 * gates on cv_risk_config: unsigned/absent config = provisional, the
 * platform keeps working on the previous logic rather than blocking).
 * Migration 3/7 (risk_questionnaire_configs) seeds a v1 config that is a
 * byte-for-byte port of risk-scoring.ts's CONDITION_RULES, as an UNSIGNED
 * DRAFT awaiting Clinical Director sign-off — so this engine only takes
 * over once a real clinician has reviewed and signed it, never silently.
 *
 * Branching (spec §2.4: "reduce unnecessary questions") is applicability-
 * based, not an explicit question graph: each question carries a predicate
 * evaluated against {previous answers, profile, derived fields}, and a
 * question is only ever shown/required when its predicate passes. This
 * gets the same "don't ask what doesn't apply" outcome as a graph without a
 * graph's failure modes (cycles, dead ends, orphaned branches) — the
 * question list is just filtered and walked in order_index order.
 */

export type QuestionnaireInputType = "boolean" | "single_select" | "multi_select" | "number" | "text";

export interface QuestionnaireOption {
  value: string;
  label: string;
}

export interface QuestionnaireQuestionConfig {
  key: string;
  category: Enums<"risk_assessment_category">;
  prompt: string;
  help_text?: string;
  input_type: QuestionnaireInputType;
  options?: QuestionnaireOption[];
  required: boolean;
  min?: number;
  max?: number;
  max_length?: number;
  /** When absent, the question is always applicable (equivalent to {op:"true"}). */
  applicability?: Predicate;
  order_index: number;
}

export interface RiskFactorConfig {
  key: string;
  points: number;
  predicate: Predicate;
}

export interface RiskConditionConfig {
  condition: PreventionCondition;
  sex_applicability: "male" | "female" | null;
  forced_high_predicate?: Predicate | null;
  moderate_threshold: number;
  high_threshold: number;
  factors: RiskFactorConfig[];
  /**
   * Question keys this condition's tier actually depends on — drives the
   * confidence calculation. Deliberately explicit rather than derived from
   * factor predicates: a factor can reference a derived field (e.g. "bmi")
   * that isn't a question key at all.
   */
  relevant_question_keys: string[];
}

export interface RiskQuestionnaireConfigPayload {
  questions: QuestionnaireQuestionConfig[];
  conditions: RiskConditionConfig[];
}

export interface QuestionnaireProfile {
  sex: Enums<"sex"> | null;
  ageYears: number | null;
  weightKg: number | null;
}

export type RiskTier = "low" | "moderate" | "high" | "unknown";
export type RiskConfidence = "low" | "moderate" | "high";

export interface ComputedRiskScoreWithConfidence {
  condition: PreventionCondition;
  tier: RiskTier;
  confidence: RiskConfidence;
  inputsSnapshot: Record<string, unknown>;
}

/** Below this fraction of relevant questions answered, a computed tier is downgraded to 'unknown'. */
const MIN_ANSWERED_FRACTION_FOR_A_COMPUTED_TIER = 1 / 3;
const HIGH_CONFIDENCE_FRACTION = 0.9;
const MODERATE_CONFIDENCE_FRACTION = 0.5;

/**
 * Whether a question_key has a real answer on file. An empty array (e.g. a
 * multi-select where the patient deliberately checked nothing — "no family
 * cancer history") counts as answered: it's a real, complete response, not
 * a skip. Only a genuinely missing value (undefined/null) or blank free
 * text counts as unanswered.
 */
function isAnswered(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function buildContext(
  responses: PredicateContext,
  profile: QuestionnaireProfile,
  bmi: number | null,
): PredicateContext {
  return {
    ...responses,
    sex: profile.sex,
    ageYears: profile.ageYears,
    bmi,
    weeklyExerciseMinutes: weeklyExerciseMinutesOf(responses),
  };
}

function bmiOf(profile: QuestionnaireProfile, responses: PredicateContext): number | null {
  const heightCm = responses.height_cm;
  const weightKg = typeof responses.weight_kg === "number" ? responses.weight_kg : profile.weightKg;
  if (typeof heightCm !== "number" || !weightKg) return null;
  const heightM = heightCm / 100;
  if (heightM <= 0) return null;
  return weightKg / (heightM * heightM);
}

/**
 * Derived field, same as bmi — WHO guideline threshold (150 min/week) is
 * applied by a factor predicate (lt weeklyExerciseMinutes 150), not here.
 */
function weeklyExerciseMinutesOf(responses: PredicateContext): number | null {
  const days = responses.exercise_days_per_week;
  const minutes = responses.exercise_minutes_per_session;
  if (typeof days !== "number" || typeof minutes !== "number") return null;
  return days * minutes;
}

/**
 * All questions currently applicable given the answers so far — the set a
 * form should render/require right now. Call again as answers change to
 * re-derive (branching): a question that was applicable can become
 * inapplicable if an earlier answer changes (e.g. smoking_status flips away
 * from "current"), in which case it drops out and its stale answer, if any,
 * should be treated as not-answered by the caller.
 */
export function getApplicableQuestions(
  config: RiskQuestionnaireConfigPayload,
  responses: PredicateContext,
  profile: QuestionnaireProfile,
): QuestionnaireQuestionConfig[] {
  const bmi = bmiOf(profile, responses);
  const context = buildContext(responses, profile, bmi);
  return [...config.questions]
    .sort((a, b) => a.order_index - b.order_index)
    .filter((q) => !q.applicability || evaluatePredicate(q.applicability, context));
}

/**
 * The single next unanswered applicable question, for a one-at-a-time
 * progressive flow. Returns null once every applicable question has an
 * answer.
 */
export function getNextApplicableQuestion(
  config: RiskQuestionnaireConfigPayload,
  responses: PredicateContext,
  profile: QuestionnaireProfile,
): QuestionnaireQuestionConfig | null {
  const applicable = getApplicableQuestions(config, responses, profile);
  return applicable.find((q) => !isAnswered(responses[q.key])) ?? null;
}

/** True once every currently-applicable question has a real answer. */
export function isQuestionnaireComplete(
  config: RiskQuestionnaireConfigPayload,
  responses: PredicateContext,
  profile: QuestionnaireProfile,
): boolean {
  return getNextApplicableQuestion(config, responses, profile) === null;
}

/**
 * A relevant_question_keys entry only counts toward a condition's
 * confidence denominator while it's actually in scope — a branched-out
 * question (e.g. cigarettes_per_day when smoking_status is "never") isn't
 * "missing data", it's correctly unasked, and must not drag confidence down.
 * A key with no matching question definition (e.g. a derived field like
 * "bmi") is always in scope.
 */
function isQuestionInScope(
  key: string,
  config: RiskQuestionnaireConfigPayload,
  context: PredicateContext,
): boolean {
  const question = config.questions.find((q) => q.key === key);
  if (!question) return true;
  return !question.applicability || evaluatePredicate(question.applicability, context);
}

function confidenceFromFraction(fraction: number): RiskConfidence {
  if (fraction >= HIGH_CONFIDENCE_FRACTION) return "high";
  if (fraction >= MODERATE_CONFIDENCE_FRACTION) return "moderate";
  return "low";
}

/**
 * Computes a tier + confidence per condition in the config.
 *
 * Missing-data handling (spec §2.6, the reason this engine exists rather
 * than reusing risk-scoring.ts's skip-on-missing-sex behaviour): a
 * sex-specific condition with no sex on file emits 'unknown', never a
 * silently-omitted row. And a condition whose relevant questions are
 * mostly unanswered emits 'unknown' rather than whatever low/moderate/high
 * band its (mostly-zero) factor score happens to land in — a "Low" reading
 * built on almost no data is exactly the false reassurance this field
 * exists to prevent.
 */
export function computeRiskFromConfig(
  config: RiskQuestionnaireConfigPayload,
  responses: PredicateContext,
  profile: QuestionnaireProfile,
): ComputedRiskScoreWithConfidence[] {
  const bmi = bmiOf(profile, responses);
  const context = buildContext(responses, profile, bmi);
  const results: ComputedRiskScoreWithConfidence[] = [];

  for (const cond of config.conditions) {
    if (cond.sex_applicability) {
      if (!profile.sex) {
        results.push({
          condition: cond.condition,
          tier: "unknown",
          confidence: "low",
          inputsSnapshot: { reason: "sex_not_on_file" },
        });
        continue;
      }
      if (profile.sex !== cond.sex_applicability) {
        continue; // genuinely not applicable to this patient — not "unknown", simply not shown
      }
    }

    if (cond.forced_high_predicate && evaluatePredicate(cond.forced_high_predicate, context)) {
      results.push({
        condition: cond.condition,
        tier: "high",
        confidence: "high",
        inputsSnapshot: { forced_by: "predicate_match" },
      });
      continue;
    }

    const inScopeKeys = cond.relevant_question_keys.filter((key) => isQuestionInScope(key, config, context));
    const answeredCount = inScopeKeys.filter((key) => isAnswered(responses[key])).length;
    const answeredFraction = inScopeKeys.length === 0 ? 1 : answeredCount / inScopeKeys.length;

    if (answeredFraction < MIN_ANSWERED_FRACTION_FOR_A_COMPUTED_TIER) {
      results.push({
        condition: cond.condition,
        tier: "unknown",
        confidence: "low",
        inputsSnapshot: {
          reason: "insufficient_data",
          answered: answeredCount,
          of: inScopeKeys.length,
        },
      });
      continue;
    }

    const matchedFactors = cond.factors.filter((factor) => evaluatePredicate(factor.predicate, context));
    const score = matchedFactors.reduce((sum, factor) => sum + factor.points, 0);
    const tier: RiskTier =
      score >= cond.high_threshold ? "high" : score >= cond.moderate_threshold ? "moderate" : "low";

    results.push({
      condition: cond.condition,
      tier,
      confidence: confidenceFromFraction(answeredFraction),
      inputsSnapshot: {
        score,
        factors: matchedFactors.map((f) => f.key),
        bmi: bmi !== null ? Math.round(bmi * 10) / 10 : null,
        answered: answeredCount,
        of: inScopeKeys.length,
      },
    });
  }

  return results;
}
