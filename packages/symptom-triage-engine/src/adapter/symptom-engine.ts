/**
 * The `SymptomEngine` interface (spec module 12, "Edge functions and services"): `start`, `answer`, `result`.
 *
 * WHY AN INTERFACE. The first adapter is Tarragon's own deterministic interpreter. A licensed knowledge-base engine could one
 * day sit behind the same three calls, so that swapping is a configuration change, not a rewrite. Nothing licensed exists
 * today, no differential ("possible causes") exists in this interface on purpose (founder decision, 2026-10-07), and no adapter
 * may call a language model in this path (INV-01).
 *
 * WHAT AN ADAPTER CAN AND CANNOT DO. An adapter returns one of the four triage categories and nothing it says is trusted past
 * `createSafeEngine`, the only way a product surface should hold an engine. The safe wrapper:
 *   - runs the bundled red-flag floor first and independently, so a fired emergency is final whatever the adapter says;
 *   - takes the more urgent of the adapter's answer and the floor, and of the adapter's answer and its own fired flags, so an
 *     adapter can never downgrade a red flag;
 *   - turns an error, a timeout, a malformed answer or a missing pathway into the degraded, escalating result, never reassurance;
 *   - then applies the prevalence and context layers, which can only raise;
 *   - copies only the fields of the result contract, so anything extra an adapter returns (for example possible causes) is
 *     dropped and never reaches a patient.
 *
 * `contract-suite.ts` is the test suite every adapter must pass.
 */
import type { RedFlagScreenResult } from "../engine/index";
import { evaluateBundledRedFlags } from "../safety/bundled-red-flags";
import { applyContextTightening, EMPTY_CONTEXT, type ClinicalContext } from "../safety/context-tightening";
import { applyRiskTightening } from "../safety/risk-tightening";
import { EngineTimeout, degradedResult, withTimeout, type DegradedModeConfig, type DegradedReason } from "../safety/safe-triage";
import {
  TRIAGE_CATEGORIES,
  mostUrgentCategory,
  type AnswerMap,
  type AnsweredQuestion,
  type QuestionAnswer,
  type QuestionNode,
  type SymptomCapture,
  type TriageCategory,
} from "../types/index";

/** Thrown by an adapter that has no pathway (or knowledge) for what was asked. The safe wrapper treats it as "protocol unavailable". */
export class PathwayUnavailableError extends Error {
  constructor(message = "no pathway available for this complaint") {
    super(message);
    this.name = "PathwayUnavailableError";
  }
}

function failureReason(e: unknown): DegradedReason {
  if (e instanceof EngineTimeout) return "engine_timeout";
  if (e instanceof PathwayUnavailableError) return "protocol_unavailable";
  return "engine_error";
}

/** Who produced a result. `licensed` is reserved for a future adapter; nothing licensed exists. */
export type EngineKind = "internal" | "licensed";

export interface EngineInput {
  capture: SymptomCapture;
  context: ClinicalContext;
  /** Resume a session the caller holds (the server re-derives state from the full answers every time, it never trusts a position). */
  answers?: AnswerMap;
  questionLog?: AnsweredQuestion[];
}

/** Everything needed to continue a session. Plain data: the server re-derives state from it and never trusts a client position. */
export interface EngineSession {
  engine: EngineKind;
  engineVersion: string;
  capture: SymptomCapture;
  context: ClinicalContext;
  answers: AnswerMap;
  questionLog: AnsweredQuestion[];
}

/** The result contract. Anything else an adapter returns is dropped by the safe wrapper. */
export interface EngineResult {
  category: TriageCategory;
  clinicianReviewRequired: boolean;
  safetyNetMessageKey: string;
  rationale: string;
  redFlagScreen: RedFlagScreenResult;
  questionsAsked: AnsweredQuestion[];
}

export type EngineStep =
  | { kind: "question"; question: QuestionNode; session: EngineSession }
  | { kind: "complete"; result: EngineResult; session: EngineSession };

export interface SymptomEngine {
  readonly engine: EngineKind;
  readonly engineVersion: string;
  start(input: EngineInput): Promise<EngineStep>;
  answer(session: EngineSession, questionKey: string, value: QuestionAnswer): Promise<EngineStep>;
  result(session: EngineSession): Promise<EngineResult>;
}

/** What the safe wrapper adds on top of the contract. */
export interface SafeAnnotations {
  degraded: boolean;
  degradedReason?: DegradedReason;
  /** The bundled floor decided or raised the category. */
  floorRaised: boolean;
  /** Ids of prevalence and context entries that raised the category. */
  raisedBy: string[];
  /** Kinds of input present (names only). */
  inputsPresent: string[];
}
export type SafeEngineResult = EngineResult & SafeAnnotations;
export type SafeEngineStep =
  | { kind: "question"; question: QuestionNode; session: EngineSession; annotations: SafeAnnotations }
  | { kind: "complete"; result: SafeEngineResult; session: EngineSession; annotations: SafeAnnotations };

/** A check for a child is never reassured below this, and a clinician is asked to look. It can only raise (PROPOSED config). */
export interface DependantPolicy {
  /** Whole years, inclusive: a person this age or younger is treated as a child. A person whose age is unknown is not matched. */
  max_age_years: number;
  minimum_category: TriageCategory;
  clinician_review_required: boolean;
}

export interface SafeEngineConfig {
  degraded: DegradedModeConfig;
  /** `symptom.risk_tightening`, raw. Omit for none. */
  riskConfig?: unknown;
  /** `symptom.context_tightening`, raw. Omit for none. */
  contextConfig?: unknown;
  /** `symptom.dependant_policy`: what a check for a child can never be less than. Omit for none. */
  dependantPolicy?: DependantPolicy;
  /** 1 to 12, Africa/Lagos, for the seasonal layer. */
  month: number;
  /** profiles.state of the person, or null. */
  state: string | null;
}

export interface SafeSymptomEngine {
  readonly engine: EngineKind;
  readonly engineVersion: string;
  start(input: EngineInput): Promise<SafeEngineStep>;
  answer(session: EngineSession, questionKey: string, value: QuestionAnswer): Promise<SafeEngineStep>;
  result(session: EngineSession): Promise<SafeEngineResult>;
}

const NO_ANNOTATIONS: SafeAnnotations = { degraded: false, floorRaised: false, raisedBy: [], inputsPresent: [] };

function isCategory(value: unknown): value is TriageCategory {
  return typeof value === "string" && (TRIAGE_CATEGORIES as readonly string[]).includes(value);
}

function isScreen(value: unknown): value is RedFlagScreenResult {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<RedFlagScreenResult>;
  return typeof v.hasFlag === "boolean" && Array.isArray(v.fired) && Array.isArray(v.brokenRules);
}

/** A result is usable only if it carries a real category and the other contract fields have the right shape. */
function validResult(value: unknown): value is EngineResult {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<EngineResult>;
  return (
    isCategory(r.category) &&
    typeof r.clinicianReviewRequired === "boolean" &&
    typeof r.safetyNetMessageKey === "string" &&
    typeof r.rationale === "string" &&
    isScreen(r.redFlagScreen) &&
    Array.isArray(r.questionsAsked)
  );
}

/** Only the contract fields: this is where "possible causes" and anything else an adapter adds is dropped. */
function pickResult(r: EngineResult): EngineResult {
  return {
    category: r.category,
    clinicianReviewRequired: r.clinicianReviewRequired,
    safetyNetMessageKey: r.safetyNetMessageKey,
    rationale: r.rationale,
    redFlagScreen: r.redFlagScreen,
    questionsAsked: r.questionsAsked,
  };
}

function validQuestion(value: unknown): value is QuestionNode {
  if (!value || typeof value !== "object") return false;
  const q = value as Partial<QuestionNode>;
  return q.type === "question" && typeof q.key === "string" && typeof q.prompt === "string" && (q.kind === "boolean" || q.kind === "choice");
}

function validStep(value: unknown): value is { kind: "question"; question: QuestionNode } | { kind: "complete"; result: EngineResult } {
  if (!value || typeof value !== "object") return false;
  const s = value as { kind?: unknown; question?: unknown; result?: unknown };
  if (s.kind === "question") return validQuestion(s.question);
  if (s.kind === "complete") return validResult(s.result);
  return false;
}

function floorOf(capture: SymptomCapture): RedFlagScreenResult {
  try {
    return evaluateBundledRedFlags(capture);
  } catch {
    return { hasFlag: false, fired: [], brokenRules: [], topCategory: null };
  }
}

/** Wrap an adapter so that nothing it does can lower a red flag or turn a failure into reassurance. */
export function createSafeEngine(adapter: SymptomEngine, config: SafeEngineConfig): SafeSymptomEngine {
  const timeoutMs = config.degraded.engine_timeout_ms;

  function degradedComplete(reason: DegradedReason, session: EngineSession): SafeEngineStep {
    const d = degradedResult(reason, session.capture, config.degraded);
    const result: SafeEngineResult = {
      ...pickResult(d),
      degraded: true,
      degradedReason: reason,
      floorRaised: d.floorRaised,
      raisedBy: [],
      inputsPresent: [],
    };
    return { kind: "complete", result, session, annotations: { degraded: true, degradedReason: reason, floorRaised: d.floorRaised, raisedBy: [], inputsPresent: [] } };
  }

  /** Apply the floor and the two tightening layers to a finished adapter result. Only ever raises. */
  function finish(raw: EngineResult, session: EngineSession): SafeEngineResult {
    const floor = floorOf(session.capture);
    let category: TriageCategory = raw.category;
    // an adapter cannot soften what its own screen found
    if (raw.redFlagScreen.topCategory) category = mostUrgentCategory(category, raw.redFlagScreen.topCategory);
    let floorRaised = false;
    let first = raw.redFlagScreen.fired[0];
    let screen = raw.redFlagScreen;
    if (floor.topCategory) {
      const next = mostUrgentCategory(category, floor.topCategory);
      if (next !== category) {
        floorRaised = true;
        category = next;
        first = floor.fired[0];
        screen = floor;
      }
    }
    let reviewRequired = raw.clinicianReviewRequired;
    let messageKey = raw.safetyNetMessageKey;
    let rationale = raw.rationale;
    if (floorRaised && first) {
      reviewRequired = true;
      messageKey = `redflag.${first.key}`;
      rationale = `Bundled red-flag floor fired: ${floor.fired.map((f) => f.key).join(", ")}`;
    }
    const raisedBy: string[] = [];
    const categoryBeforeLayers = category;
    const risk = applyRiskTightening(category, { capture: session.capture, month: config.month, state: config.state }, config.riskConfig ?? { entries: [] });
    if (risk.category !== category) {
      category = risk.category;
      raisedBy.push(...risk.raisedBy);
    }
    const ctx = applyContextTightening(category, session.context, session.capture, config.contextConfig ?? { entries: [] });
    if (ctx.category !== category) {
      category = ctx.category;
      raisedBy.push(...ctx.raisedBy);
    }
    const dep = config.dependantPolicy;
    if (dep && session.context.ageYears !== null && session.context.ageYears <= dep.max_age_years) {
      const next = mostUrgentCategory(category, dep.minimum_category);
      if (next !== category) {
        category = next;
        raisedBy.push("dependant_policy");
      }
      if (dep.clinician_review_required && !reviewRequired) {
        reviewRequired = true;
        if (!raisedBy.includes("dependant_policy")) raisedBy.push("dependant_policy");
      }
    }
    if (raisedBy.length > 0) {
      reviewRequired = true;
      // the old key's wording belongs to the old, lower category: an unknown key falls back to the new category's own copy
      if (category !== categoryBeforeLayers) messageKey = "risk.raised";
      rationale = `${rationale} | raised to ${category} by the prevalence or context layer: ${raisedBy.join(", ")}`;
    }
    return {
      ...pickResult({ category, clinicianReviewRequired: reviewRequired, safetyNetMessageKey: messageKey, rationale, redFlagScreen: screen, questionsAsked: raw.questionsAsked }),
      degraded: false,
      floorRaised,
      raisedBy,
      inputsPresent: ctx.inputsPresent,
    };
  }

  /** An emergency floor ends a session that is still asking questions. (A finished result is raised by `finish`; a failed adapter by the degraded path.) */
  function floorEmergency(session: EngineSession): SafeEngineStep | null {
    const floor = floorOf(session.capture);
    if (floor.topCategory !== "emergency") return null;
    const first = floor.fired[0]!;
    const result = finish(
      {
        category: "emergency",
        clinicianReviewRequired: true,
        safetyNetMessageKey: `redflag.${first.key}`,
        rationale: `Bundled red-flag floor fired: ${floor.fired.map((f) => f.key).join(", ")}`,
        redFlagScreen: floor,
        questionsAsked: [],
      },
      session,
    );
    return { kind: "complete", result: { ...result, floorRaised: true }, session, annotations: { degraded: false, floorRaised: true, raisedBy: result.raisedBy, inputsPresent: result.inputsPresent } };
  }

  async function guardedStep(session: EngineSession, run: () => Promise<EngineStep>): Promise<SafeEngineStep> {
    let step: unknown;
    try {
      step = await withTimeout(run, timeoutMs);
    } catch (e) {
      return degradedComplete(failureReason(e), session);
    }
    if (!validStep(step)) return degradedComplete("engine_error", session);
    const nextSession = ((step as { session?: EngineSession }).session as EngineSession | undefined) ?? session;
    // the capture and context are the caller's, never the adapter's: an adapter cannot swap in a milder capture for the floor
    const pinned: EngineSession = { ...nextSession, capture: session.capture, context: session.context, engine: adapter.engine, engineVersion: adapter.engineVersion };
    if (step.kind === "question") {
      // an emergency flag ends the walk: no further question is asked of someone the floor says needs an emergency department
      const stop = floorEmergency(pinned);
      if (stop) return stop;
      return { kind: "question", question: step.question, session: pinned, annotations: { ...NO_ANNOTATIONS, inputsPresent: [] } };
    }
    const result = finish(step.result, pinned);
    return { kind: "complete", result, session: pinned, annotations: { degraded: false, floorRaised: result.floorRaised, raisedBy: result.raisedBy, inputsPresent: result.inputsPresent } };
  }

  function newSession(input: EngineInput): EngineSession {
    return { engine: adapter.engine, engineVersion: adapter.engineVersion, capture: input.capture, context: input.context ?? EMPTY_CONTEXT, answers: input.answers ?? {}, questionLog: input.questionLog ?? [] };
  }

  return {
    engine: adapter.engine,
    engineVersion: adapter.engineVersion,
    start: (input) => guardedStep(newSession(input), () => Promise.resolve(adapter.start(input))),
    answer: (session, key, value) => guardedStep(session, () => Promise.resolve(adapter.answer(session, key, value))),
    async result(session) {
      let raw: unknown;
      try {
        raw = await withTimeout(() => Promise.resolve(adapter.result(session)), timeoutMs);
      } catch (e) {
        const d = degradedComplete(failureReason(e), session);
        return (d as Extract<SafeEngineStep, { kind: "complete" }>).result;
      }
      if (!validResult(raw)) {
        const d = degradedComplete("engine_error", session);
        return (d as Extract<SafeEngineStep, { kind: "complete" }>).result;
      }
      return finish(raw, session);
    },
  };
}
