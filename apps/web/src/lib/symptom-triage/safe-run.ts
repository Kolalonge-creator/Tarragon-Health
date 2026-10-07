import { getProposedConfig } from "@tarragon/shared";
import {
  applyRiskTightening,
  runTriageFailSafe,
  type AnswerMap,
  type AnsweredQuestion,
  type DegradedModeConfig,
  type EngineFn,
  type PresentingComplaintProtocol,
  type SafeTriageResult,
  type SymptomCapture,
  type TriageCategory,
} from "@tarragon/symptom-triage-engine";

/**
 * S60 (spec 12.2, 12.8, 12.11): the single place the symptom checker's result is decided, so that the fail-toward-escalation
 * rule and the "can only tighten" prevalence layer cannot be skipped by a call site.
 *
 *   1. runTriageFailSafe: the bundled red-flag floor first, the engine bounded by a timeout, any failure escalates.
 *   2. applyRiskTightening: the versioned prevalence and seasonal layer, which can only raise the category.
 *
 * Both configs are PROPOSED values read from the versioned registry (never constants here). This module has no I/O and calls no
 * model (INV-01).
 */

export interface SafeRunInput {
  pathway: PresentingComplaintProtocol | null;
  capture: SymptomCapture;
  answers: AnswerMap;
  questionLog?: AnsweredQuestion[];
  /** profiles.state of the person the check is for, or null. */
  state: string | null;
  /** Injected for tests; defaults to the in-house interpreter. */
  engine?: EngineFn;
  now?: Date;
  /** Injected for tests; defaults to the versioned `symptom.risk_tightening` entry. */
  riskConfig?: unknown;
}

export interface SafeRunResult extends SafeTriageResult {
  /** Ids of risk entries that raised the category (empty in practice until the CMO signs one). */
  raisedByRisk: string[];
}

export function degradedModeConfig(): DegradedModeConfig {
  return getProposedConfig("symptom.degraded_mode").value as unknown as DegradedModeConfig;
}

/** The month in Africa/Lagos (UTC+1, no DST), 1 to 12. */
export function lagosMonth(now: Date): number {
  return new Date(now.getTime() + 60 * 60 * 1000).getUTCMonth() + 1;
}

export async function runSymptomCheck(input: SafeRunInput): Promise<SafeRunResult> {
  const result = await runTriageFailSafe({
    pathway: input.pathway,
    capture: input.capture,
    answers: input.answers,
    questionLog: input.questionLog,
    degraded: degradedModeConfig(),
    engine: input.engine,
  });
  // While a question is pending nothing is decided yet, so there is nothing to tighten.
  if (result.nextQuestion) return { ...result, raisedByRisk: [] };

  const risk = input.riskConfig ?? getProposedConfig("symptom.risk_tightening").value;
  const tightened = applyRiskTightening(
    result.category,
    { capture: input.capture, month: lagosMonth(input.now ?? new Date()), state: input.state },
    risk,
  );
  if (tightened.category === result.category) return { ...result, raisedByRisk: [] };
  const category: TriageCategory = tightened.category;
  return {
    ...result,
    category,
    clinicianReviewRequired: true,
    rationale: `${result.rationale} | raised to ${category} by the prevalence layer: ${tightened.raisedBy.join(", ")}`,
    raisedByRisk: tightened.raisedBy,
  };
}
