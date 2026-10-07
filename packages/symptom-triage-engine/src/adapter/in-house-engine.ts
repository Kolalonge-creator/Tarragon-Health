/**
 * The first `SymptomEngine` adapter: Tarragon's own deterministic interpreter over the signed pathway config.
 *
 * It is a thin adapter over `runTriage` and `nextTriageStep`. It has no I/O, no randomness, no clock and no model (INV-01), and it
 * knows nothing about possible causes: the interpreter answers "what is the safest next step", never "what is the diagnosis".
 * A real product surface holds it through `createSafeEngine`, never bare.
 */
import { runTriage } from "../engine/index";
import { findPathway, type PresentingComplaintProtocol, type QuestionAnswer } from "../types/index";
import {
  PathwayUnavailableError,
  type EngineInput,
  type EngineResult,
  type EngineSession,
  type EngineStep,
  type SymptomEngine,
} from "./symptom-engine";

export const IN_HOUSE_ENGINE_VERSION = "in_house.1";

export interface InHouseEngineOptions {
  /** The signed pathways (or, in tests, any). Looked up by the capture's presenting complaint key. */
  pathways: readonly PresentingComplaintProtocol[];
}

export function createInHouseEngine(options: InHouseEngineOptions): SymptomEngine {
  const pathwayFor = (key: string): PresentingComplaintProtocol => {
    const found = findPathway({ version: 0, pathways: [...options.pathways] }, key);
    if (!found) throw new PathwayUnavailableError(`no pathway "${key}"`);
    return found;
  };

  function run(session: EngineSession): EngineStep {
    const pathway = pathwayFor(session.capture.presentingComplaintKey);
    const r = runTriage(pathway, session.capture, session.answers, session.questionLog);
    if (r.nextQuestion) return { kind: "question", question: r.nextQuestion, session };
    const result: EngineResult = {
      category: r.category,
      clinicianReviewRequired: r.clinicianReviewRequired,
      safetyNetMessageKey: r.safetyNetMessageKey,
      rationale: r.rationale,
      redFlagScreen: r.redFlagScreen,
      questionsAsked: r.questionsAsked,
    };
    return { kind: "complete", result, session: { ...session, questionLog: r.questionsAsked } };
  }

  return {
    engine: "internal",
    engineVersion: IN_HOUSE_ENGINE_VERSION,
    async start(input: EngineInput) {
      return run({ engine: "internal", engineVersion: IN_HOUSE_ENGINE_VERSION, capture: input.capture, context: input.context, answers: input.answers ?? {}, questionLog: input.questionLog ?? [] });
    },
    async answer(session: EngineSession, questionKey: string, value: QuestionAnswer) {
      return run({ ...session, answers: { ...session.answers, [questionKey]: value } });
    },
    async result(session: EngineSession) {
      const step = run(session);
      if (step.kind === "complete") return step.result;
      // a session that is not finished has no result yet: say so by throwing, which the safe wrapper turns into an escalation
      throw new Error("the session is not finished: a question is still waiting for an answer");
    },
  };
}
