/**
 * Fail toward escalation (spec 12.8, INV-01, INV-06).
 *
 * `runTriageFailSafe` is the one entry point a product surface should call. It guarantees three things the bare interpreter
 * (`runTriage`) does not:
 *
 *  1. The bundled red-flag floor runs FIRST and independently of the engine. A fired emergency flag can never be argued down:
 *     the final category is `mostUrgentCategory(engine result, floor result)`.
 *  2. If the engine throws, times out, or there is no protocol to run, the answer is never "all clear". It is the more urgent
 *     of (the degraded red-flag floor, the configured unclassifiable category), and a human is asked to look. "Chest pain with
 *     sweating" returns emergency even when the engine is down.
 *  3. Nothing here calls a model, the network or the database (INV-01). The timeout bounds a (possibly async) engine adapter
 *     such as the future licensed one behind the `SymptomEngine` interface; the in-house interpreter is synchronous.
 *
 * The degraded behaviour is PROPOSED configuration (`symptom.degraded_mode`, owner CMO) passed in by the caller, never a
 * constant here.
 */
import type { RedFlagScreenResult, TriageRunResult } from "../engine/index";
import { runTriage } from "../engine/index";
import { TRIAGE_CATEGORIES, mostUrgentCategory, type AnswerMap, type AnsweredQuestion, type PresentingComplaintProtocol, type SymptomCapture, type TriageCategory } from "../types/index";
import { evaluateBundledRedFlags } from "./bundled-red-flags";

export interface DegradedModeConfig {
  /** Degraded screen ignores the severity floors of the signed rules (a strictly more sensitive screen). */
  ignore_severity_floors: boolean;
  /** What an unclassifiable run is treated as when no red flag fired. Never below "urgent". */
  unclassifiable_category: "emergency" | "urgent";
  /** How long an engine adapter may take before the run is treated as failed. */
  engine_timeout_ms: number;
}

export type DegradedReason = "engine_error" | "engine_timeout" | "protocol_unavailable";

export interface SafeTriageResult extends TriageRunResult {
  degraded: boolean;
  degradedReason?: DegradedReason;
  /** True when the bundled floor decided or raised the category. */
  floorRaised: boolean;
}

/**
 * An engine adapter. The optional fifth argument is an AbortSignal that is aborted when the run times out, so an async engine
 * (a licensed adapter making a network call) can cancel its own work instead of running on after the caller has moved on.
 * Backward compatible: an engine written with four parameters is still assignable and simply ignores the signal.
 */
export type EngineFn = (
  pathway: PresentingComplaintProtocol,
  capture: SymptomCapture,
  answers: AnswerMap,
  questionLog: AnsweredQuestion[],
  signal?: AbortSignal,
) => TriageRunResult | Promise<TriageRunResult>;

export interface FailSafeInput {
  pathway: PresentingComplaintProtocol | null;
  capture: SymptomCapture;
  answers: AnswerMap;
  questionLog?: AnsweredQuestion[];
  degraded: DegradedModeConfig;
  /** The engine to run. Defaults to the in-house interpreter. Injected so a licensed adapter, or a test, can stand in. */
  engine?: EngineFn;
}

const EMPTY_SCREEN: RedFlagScreenResult = { hasFlag: false, fired: [], brokenRules: [], topCategory: null };

export class EngineTimeout extends Error {
  constructor() {
    super("engine timeout");
  }
}

export async function withTimeout<T>(work: (signal: AbortSignal) => T | Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  try {
    return await Promise.race([
      (async () => work(controller.signal))(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // abort first so the engine can stop, then fail the run
          controller.abort(new EngineTimeout());
          reject(new EngineTimeout());
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function degradedResult(reason: DegradedReason, capture: SymptomCapture, config: DegradedModeConfig): SafeTriageResult {
  let floor: RedFlagScreenResult = EMPTY_SCREEN;
  try {
    floor = evaluateBundledRedFlags(capture, { ignoreSeverityFloors: config.ignore_severity_floors });
  } catch {
    floor = EMPTY_SCREEN;
  }
  const floorCategory = floor.topCategory;
  const category = floorCategory ? mostUrgentCategory(floorCategory, config.unclassifiable_category) : config.unclassifiable_category;
  const first = floor.fired[0];
  return {
    category,
    clinicianReviewRequired: true,
    safetyNetMessageKey: first ? `redflag.${first.key}` : "degraded.engine_unavailable",
    rationale: first
      ? `Engine unavailable (${reason}); fail-toward-escalation floor fired: ${floor.fired.map((f) => f.key).join(", ")}`
      : `Engine unavailable (${reason}); no red flag fired on the bundled floor, routed to urgent human review rather than reassurance`,
    redFlagScreen: floor,
    questionsAsked: [],
    degraded: true,
    degradedReason: reason,
    floorRaised: floorCategory !== null,
  };
}

function isCategory(value: unknown): value is TriageCategory {
  return typeof value === "string" && (TRIAGE_CATEGORIES as readonly string[]).includes(value);
}

/** Run the triage so that a failure of the engine can only ever escalate. Never throws. */
export async function runTriageFailSafe(input: FailSafeInput): Promise<SafeTriageResult> {
  const { pathway, capture, answers, degraded } = input;
  const questionLog = input.questionLog ?? [];
  if (!pathway) return degradedResult("protocol_unavailable", capture, degraded);

  // 1. The floor, as signed, before and independently of the engine.
  let floor: RedFlagScreenResult = EMPTY_SCREEN;
  try {
    floor = evaluateBundledRedFlags(capture);
  } catch {
    floor = EMPTY_SCREEN;
  }

  // 2. The engine, bounded. Any failure is a degraded result, never silence.
  const engine: EngineFn = input.engine ?? ((p, c, a, q) => runTriage(p, c, a, q));
  let result: TriageRunResult;
  try {
    result = await withTimeout((signal) => engine(pathway, capture, answers, questionLog, signal), degraded.engine_timeout_ms);
  } catch (e) {
    return degradedResult(e instanceof EngineTimeout ? "engine_timeout" : "engine_error", capture, degraded);
  }
  // A result that is not one of the four categories is a broken engine, not an answer.
  if (!result || !isCategory(result.category)) return degradedResult("engine_error", capture, degraded);

  // 3. The floor can only raise. While a question is still pending no category is decided, but a fired floor ends the walk.
  const first = floor.fired[0];
  // While a question is pending, only an EMERGENCY floor ends the walk: an urgent floor leaves it running, because a later answer may
  // still raise the result to emergency, and the floor is applied again to the final result (it is recomputed on every call).
  const floorRaises =
    floor.topCategory !== null &&
    (result.nextQuestion !== undefined ? floor.topCategory === "emergency" : mostUrgentCategory(floor.topCategory, result.category) !== result.category);
  if (floorRaises && floor.topCategory && first) {
    return {
      ...result,
      category: floor.topCategory,
      clinicianReviewRequired: true,
      safetyNetMessageKey: `redflag.${first.key}`,
      rationale: `Bundled red-flag floor fired: ${floor.fired.map((f) => f.key).join(", ")}`,
      redFlagScreen: floor,
      nextQuestion: undefined,
      // keep what the engine really asked: the record shows the questions the patient answered before the floor ended the walk
      questionsAsked: result.questionsAsked,
      degraded: false,
      floorRaised: true,
    };
  }
  return { ...result, degraded: false, floorRaised: false };
}
