/**
 * The triage interpreter (spec §37.4, §37.6, §37.7).
 *
 * INVARIANTS (mirrors @tarragon/lifestyle-engine's safety core discipline):
 *  1. Runs synchronously and deterministically — same config + same inputs
 *     always produce the same output. No hidden state, no I/O.
 *  2. The red-flag screen runs BEFORE any question is asked (§37.4's flow
 *     diagram) and short-circuits straight to `emergency` — a red flag is
 *     never "argued down" by a later question.
 *  3. Every fired red flag is recorded, not just the first — nothing is
 *     silently dropped (mirrors lifestyle-engine's evaluateRedFlags).
 *  4. A throwing rule/predicate is treated as not-fired here, but is
 *     reported via `brokenRules` so it can be surfaced as a bug, not
 *     silently swallowed forever.
 *  5. This module never resolves/closes anything and never contacts a
 *     patient — it only classifies. Escalation side-effects (creating a
 *     clinician_alerts/emergency_events row) are a DB-trigger concern, by
 *     design (see the migration), the same "can't be silently dropped by a
 *     missing app-layer check" discipline as private.handle_symptom_red_flag.
 */
import type {
  AnswerMap,
  AnsweredQuestion,
  OutcomeNode,
  PresentingComplaintProtocol,
  QuestionAnswer,
  QuestionNode,
  RedFlagCondition,
  RedFlagRule,
  SymptomCapture,
  TriageCategory,
} from "../types/index";
import { mostUrgentCategory } from "../types/index";

/**
 * Evaluate one declarative red-flag condition against a capture. Every
 * present key is AND-ed; this can never throw on a well-typed
 * `RedFlagCondition` (the caller still guards with try/catch as defence in
 * depth against a malformed/hand-edited jsonb config slipping past its zod
 * validation at the load boundary).
 */
export function evaluateCondition(condition: RedFlagCondition, capture: SymptomCapture): boolean {
  if (condition.onset !== undefined && capture.onset !== condition.onset) return false;
  if (condition.minSeverity !== undefined && capture.severity < condition.minSeverity) return false;
  if (condition.anyAssociatedSymptom !== undefined) {
    if (!condition.anyAssociatedSymptom.some((s) => capture.associatedSymptoms.includes(s))) return false;
  }
  if (condition.allAssociatedSymptoms !== undefined) {
    if (!condition.allAssociatedSymptoms.every((s) => capture.associatedSymptoms.includes(s))) return false;
  }
  if (condition.anyTrigger !== undefined) {
    if (!condition.anyTrigger.some((t) => capture.triggers.includes(t))) return false;
  }
  if (condition.anyHistory !== undefined) {
    if (!condition.anyHistory.some((h) => capture.relevantHistory.includes(h))) return false;
  }
  if (condition.measurementBelow !== undefined) {
    const v = capture.measurements[condition.measurementBelow.key];
    if (typeof v !== "number" || !(v < condition.measurementBelow.value)) return false;
  }
  if (condition.measurementAtLeast !== undefined) {
    const v = capture.measurements[condition.measurementAtLeast.key];
    if (typeof v !== "number" || !(v >= condition.measurementAtLeast.value)) return false;
  }
  return true;
}

export interface FiredRedFlag {
  key: string;
  label: string;
  category: TriageCategory;
}

export interface RedFlagScreenResult {
  hasFlag: boolean;
  fired: FiredRedFlag[];
  brokenRules: string[];
  /** Highest category across fired flags, or null if none fired. */
  topCategory: TriageCategory | null;
}

/** Step 1 of the flow diagram: Symptom -> Red flag screen -> emergency?. */
export function screenRedFlags(
  capture: SymptomCapture,
  rules: readonly RedFlagRule[],
): RedFlagScreenResult {
  const fired: FiredRedFlag[] = [];
  const brokenRules: string[] = [];

  for (const rule of rules) {
    let hit = false;
    try {
      hit = evaluateCondition(rule.rule, capture);
    } catch {
      brokenRules.push(rule.key);
      hit = false;
    }
    if (hit) {
      fired.push({ key: rule.key, label: rule.label, category: rule.category });
    }
  }

  const topCategory = fired.reduce<TriageCategory | null>(
    (top, f) => (top === null ? f.category : mostUrgentCategory(top, f.category)),
    null,
  );

  return { hasFlag: fired.length > 0, fired, brokenRules, topCategory };
}

// ---------------------------------------------------------------------------
// Dynamic questionnaire walk (spec §37.6/§37.7)
// ---------------------------------------------------------------------------

export type TriageStep =
  | { done: false; question: QuestionNode }
  | { done: true; outcome: OutcomeNode; questionsAsked: AnsweredQuestion[] };

/**
 * Walk the pathway's question graph given the answers collected so far.
 * `answers` is keyed by question key in the order they were answered —
 * this function is pure and re-derives the current node from scratch every
 * call, so a server action can safely re-run it rather than trust
 * client-held position state (§37.6: "questions should be dynamic", but
 * the server never trusts which question a client claims it is on).
 */
export function nextTriageStep(
  pathway: PresentingComplaintProtocol,
  answers: AnswerMap,
  questionLog: AnsweredQuestion[] = [],
): TriageStep {
  let nodeKey = pathway.startNodeKey;
  let guard = 0;
  const asked: AnsweredQuestion[] = [];

  while (guard++ < 1000) {
    const node = pathway.nodes[nodeKey];
    if (!node) {
      // Dead end in the config — a broken graph must never crash the
      // patient's session. Fail toward caution, not toward "all clear".
      return {
        done: true,
        outcome: pathway.fallbackOutcome,
        questionsAsked: asked,
      };
    }

    if (node.type === "outcome") {
      return { done: true, outcome: node, questionsAsked: asked };
    }

    const answer = answers[node.key];
    if (answer === undefined) {
      return { done: false, question: node };
    }

    const logged = questionLog.find((q) => q.questionKey === node.key);
    asked.push(
      logged ?? {
        questionKey: node.key,
        prompt: node.prompt,
        answer,
        answeredAt: new Date().toISOString(),
      },
    );

    nodeKey = resolveNext(node, answer, pathway.fallbackOutcome.key);
  }

  // Guard tripped — a cyclic config would otherwise infinite-loop a patient
  // session. Treat as a broken protocol: never resolve silently as "safe".
  return { done: true, outcome: pathway.fallbackOutcome, questionsAsked: asked };
}

function resolveNext(node: QuestionNode, answer: QuestionAnswer, fallbackKey: string): string {
  if (node.kind === "boolean") {
    return answer === true ? node.onYes : node.onNo;
  }
  const option = node.options.find((o) => o.value === answer);
  return option?.next ?? fallbackKey;
}

// ---------------------------------------------------------------------------
// Full run — red-flag screen + questionnaire walk in one call. This is what
// a server action should call end to end; it never trusts a client-supplied
// final category (mirrors mental_health_screens/prevention_risk_scores:
// scores/classifications are always recomputed server-side).
// ---------------------------------------------------------------------------

export interface TriageRunResult {
  category: TriageCategory;
  clinicianReviewRequired: boolean;
  safetyNetMessageKey: string;
  rationale: string;
  redFlagScreen: RedFlagScreenResult;
  questionsAsked: AnsweredQuestion[];
  /** Present only when the questionnaire is still in progress. */
  nextQuestion?: QuestionNode;
}

export function runTriage(
  pathway: PresentingComplaintProtocol,
  capture: SymptomCapture,
  answers: AnswerMap,
  questionLog: AnsweredQuestion[] = [],
): TriageRunResult {
  const redFlagScreen = screenRedFlags(capture, pathway.redFlagScreen);

  if (redFlagScreen.hasFlag && redFlagScreen.topCategory) {
    return {
      category: redFlagScreen.topCategory,
      // A fired red flag is, by definition, not ambiguous — but a broken
      // predicate alongside a real fire still deserves a human look.
      clinicianReviewRequired: redFlagScreen.brokenRules.length > 0,
      safetyNetMessageKey: `redflag.${redFlagScreen.fired[0]!.key}`,
      rationale: `Red-flag screen fired: ${redFlagScreen.fired.map((f) => f.key).join(", ")}`,
      redFlagScreen,
      questionsAsked: [],
    };
  }

  const step = nextTriageStep(pathway, answers, questionLog);
  if (!step.done) {
    return {
      category: "self_management",
      clinicianReviewRequired: false,
      safetyNetMessageKey: "",
      rationale: "",
      redFlagScreen,
      questionsAsked: [],
      nextQuestion: step.question,
    };
  }

  return {
    category: step.outcome.category,
    clinicianReviewRequired: step.outcome.clinicianReviewRequired || redFlagScreen.brokenRules.length > 0,
    safetyNetMessageKey: step.outcome.safetyNetMessageKey,
    rationale: step.outcome.rationale,
    redFlagScreen,
    questionsAsked: step.questionsAsked,
  };
}
