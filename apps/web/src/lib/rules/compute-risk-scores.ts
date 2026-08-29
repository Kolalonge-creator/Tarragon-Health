import type { SupabaseClient } from "@supabase/supabase-js";
import { computeRiskTiers, type PreventionCondition, type RiskScoringProfile } from "./risk-scoring";
import {
  computeRiskFromConfig,
  type QuestionnaireProfile,
  type RiskConfidence,
  type RiskQuestionnaireConfigPayload,
  type RiskTier,
} from "./risk-questionnaire-engine";
import type { RiskAssessmentInput } from "@/lib/validation/risk-assessment";
import type { Database } from "@tarragon/shared";

export interface ScoredCondition {
  condition: PreventionCondition;
  tier: RiskTier;
  confidence: RiskConfidence;
  inputsSnapshot: Record<string, unknown>;
  modelName: string;
  modelVersion: string;
}

const QUESTIONNAIRE_CODE = "prevention_intake";
const LEGACY_MODEL_NAME = "rule_based_condition_tiering";
const LEGACY_MODEL_VERSION = "legacy_hardcoded_v1";

/**
 * Computes prevention risk tiers for a patient, preferring a signed, active
 * risk_questionnaire_configs row over the hardcoded lib/rules/risk-scoring.ts
 * engine — same "config, once signed, wins" pattern this codebase already
 * uses for cv_risk_config (see lib/cv-risk/assess.ts). If no organisation
 * has yet signed a prevention_intake config, every patient keeps getting
 * exactly today's behaviour: the legacy engine, confidence 'high' (the
 * fixed Zod form requires every field, so a submission is always complete).
 */
export async function computePreventionRiskScores(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts both the RLS-scoped and service-role clients
  supabase: SupabaseClient<Database, any, any>,
  organisationId: string,
  responses: RiskAssessmentInput,
  profile: RiskScoringProfile,
): Promise<ScoredCondition[]> {
  const { data: activeConfig } = await supabase
    .from("risk_questionnaire_configs")
    .select("version, config")
    .eq("organisation_id", organisationId)
    .eq("code", QUESTIONNAIRE_CODE)
    .eq("is_active", true)
    .maybeSingle();

  if (activeConfig) {
    const payload = activeConfig.config as unknown as RiskQuestionnaireConfigPayload;
    const questionnaireProfile: QuestionnaireProfile = profile;
    const results = computeRiskFromConfig(
      payload,
      responses as unknown as Record<string, unknown>,
      questionnaireProfile,
    );
    return results.map((r) => ({
      condition: r.condition,
      tier: r.tier,
      confidence: r.confidence,
      inputsSnapshot: r.inputsSnapshot,
      modelName: QUESTIONNAIRE_CODE,
      modelVersion: String(activeConfig.version),
    }));
  }

  const legacy = computeRiskTiers(responses, profile);
  return legacy.map((r) => ({
    condition: r.condition,
    tier: r.tier,
    confidence: "high",
    inputsSnapshot: r.inputsSnapshot,
    modelName: LEGACY_MODEL_NAME,
    modelVersion: LEGACY_MODEL_VERSION,
  }));
}
