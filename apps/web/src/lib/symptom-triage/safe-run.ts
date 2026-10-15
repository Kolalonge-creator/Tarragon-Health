import { getProposedConfig } from "@tarragon/shared";
import {
  EMPTY_CONTEXT,
  PathwayUnavailableError,
  createInHouseEngine,
  createSafeEngine,
  deriveUrgencyLevel,
  type AnswerMap,
  type AnsweredQuestion,
  type ClinicalContext,
  type DegradedModeConfig,
  type DependantPolicy,
  type EngineFn,
  type EngineStep,
  type PresentingComplaintProtocol,
  type SafeTriageResult,
  type SymptomCapture,
  type SymptomEngine,
  type UrgencyLevel,
} from "@tarragon/symptom-triage-engine";

/**
 * S60 (spec 12.2, 12.8, 12.11): the single place the symptom checker's result is decided, so that the fail-toward-escalation
 * rule and the "can only tighten" prevalence layer cannot be skipped by a call site.
 *
 *   1. createSafeEngine over a SymptomEngine adapter (the in-house interpreter): the bundled red-flag floor first, the adapter bounded by a
 *      timeout, any failure escalates, and the adapter can never downgrade a red flag (S59).
 *   2. The versioned prevalence, record-context and dependant layers, which can only raise the category (S59, spec 12.2, 12.6).
 *   3. The six-level wording, derived only from a SIGNED urgency map (spec 12.4); null otherwise.
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
  /** What the health record says (age, sex, pregnancy, conditions, medicines, readings). Defaults to nothing known. */
  context?: ClinicalContext;
  /** Injected for tests; defaults to the in-house interpreter. Wrapped as an adapter, so the safe wrapper still applies. */
  engine?: EngineFn;
  now?: Date;
  /** Injected for tests; defaults to the versioned `symptom.risk_tightening` entry. */
  riskConfig?: unknown;
  /** Injected for tests; defaults to the versioned `symptom.context_tightening` entry. */
  contextConfig?: unknown;
  /** Injected for tests; defaults to the versioned `symptom.dependant_policy` entry. */
  dependantPolicy?: DependantPolicy;
  /** Injected for tests; defaults to the versioned `symptom.urgency_map` entry. */
  urgencyMap?: unknown;
}

export interface SafeRunResult extends SafeTriageResult {
  /** Ids of risk, context and dependant entries that raised the category (empty in practice until the CMO signs one). */
  raisedByRisk: string[];
  raisedBy: string[];
  /** Kinds of record input that were present (names only). */
  inputsPresent: string[];
  engine: "internal" | "licensed";
  engineVersion: string;
  /** The six-level wording, or null when no signed urgency map is in force (then only the four-category result is shown). */
  urgencyLevel: UrgencyLevel | null;
  urgencyMapVersion: number | null;
}

export function degradedModeConfig(): DegradedModeConfig {
  return getProposedConfig("symptom.degraded_mode").value as unknown as DegradedModeConfig;
}

/** The month in Africa/Lagos (UTC+1, no DST), 1 to 12. */
export function lagosMonth(now: Date): number {
  return new Date(now.getTime() + 60 * 60 * 1000).getUTCMonth() + 1;
}

/** Wraps a bare engine function (the older test seam) as a SymptomEngine adapter, so it is held to the same contract. */
function adapterFromEngineFn(fn: EngineFn, pathway: PresentingComplaintProtocol | null): SymptomEngine {
  async function step(input: { capture: SymptomCapture; context: ClinicalContext; answers?: AnswerMap; questionLog?: AnsweredQuestion[] }): Promise<EngineStep> {
    if (!pathway) throw new PathwayUnavailableError();
    const session = { engine: "internal" as const, engineVersion: "engine_fn", capture: input.capture, context: input.context, answers: input.answers ?? {}, questionLog: input.questionLog ?? [] };
    const r = await fn(pathway, input.capture, session.answers, session.questionLog);
    if (r.nextQuestion) return { kind: "question", question: r.nextQuestion, session };
    return {
      kind: "complete",
      session,
      result: { category: r.category, clinicianReviewRequired: r.clinicianReviewRequired, safetyNetMessageKey: r.safetyNetMessageKey, rationale: r.rationale, redFlagScreen: r.redFlagScreen, questionsAsked: r.questionsAsked },
    };
  }
  return {
    engine: "internal",
    engineVersion: "engine_fn",
    start: (input) => step(input),
    answer: (s, k, v) => step({ capture: s.capture, context: s.context, answers: { ...s.answers, [k]: v }, questionLog: s.questionLog }),
    result: async (s) => {
      const r = await step({ capture: s.capture, context: s.context, answers: s.answers, questionLog: s.questionLog });
      if (r.kind !== "complete") throw new Error("not finished");
      return r.result;
    },
  };
}

export async function runSymptomCheck(input: SafeRunInput): Promise<SafeRunResult> {
  const adapter = input.engine ? adapterFromEngineFn(input.engine, input.pathway) : createInHouseEngine({ pathways: input.pathway ? [input.pathway] : [] });
  const safe = createSafeEngine(adapter, {
    degraded: degradedModeConfig(),
    riskConfig: input.riskConfig ?? getProposedConfig("symptom.risk_tightening").value,
    contextConfig: input.contextConfig ?? getProposedConfig("symptom.context_tightening").value,
    dependantPolicy: input.dependantPolicy ?? (getProposedConfig("symptom.dependant_policy").value as unknown as DependantPolicy),
    month: lagosMonth(input.now ?? new Date()),
    state: input.state,
  });
  const step = await safe.start({ capture: input.capture, context: input.context ?? EMPTY_CONTEXT, answers: input.answers, questionLog: input.questionLog ?? [] });
  const tail = { engine: adapter.engine, engineVersion: adapter.engineVersion };
  if (step.kind === "question") {
    return {
      category: "self_management",
      clinicianReviewRequired: false,
      safetyNetMessageKey: "",
      rationale: "",
      redFlagScreen: { hasFlag: false, fired: [], brokenRules: [], topCategory: null },
      questionsAsked: [],
      nextQuestion: step.question,
      degraded: false,
      floorRaised: false,
      raisedByRisk: [],
      raisedBy: [],
      inputsPresent: [],
      urgencyLevel: null,
      urgencyMapVersion: null,
      ...tail,
    };
  }
  const r = step.result;
  const urgencyMap = input.urgencyMap ?? getProposedConfig("symptom.urgency_map").value;
  const urgencyLevel = deriveUrgencyLevel(r.category, r.clinicianReviewRequired, urgencyMap);
  return {
    category: r.category,
    clinicianReviewRequired: r.clinicianReviewRequired,
    safetyNetMessageKey: r.safetyNetMessageKey,
    rationale: r.rationale,
    redFlagScreen: r.redFlagScreen,
    questionsAsked: r.questionsAsked,
    degraded: r.degraded,
    degradedReason: r.degradedReason,
    floorRaised: r.floorRaised,
    raisedByRisk: r.raisedBy,
    raisedBy: r.raisedBy,
    inputsPresent: r.inputsPresent,
    urgencyLevel,
    urgencyMapVersion: urgencyLevel ? getProposedConfig("symptom.urgency_map").version : null,
    ...tail,
  };
}
