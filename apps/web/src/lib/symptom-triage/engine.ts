import type {
  InitialCapture,
  OutcomeNode,
  QuestionNode,
  RedFlagRule,
  RedFlagScreenEntry,
  TriagePathway,
} from "./types";

/** Answers collected so far while walking a pathway's node graph, keyed by
 * question node key. A boolean question stores true/false; a choice
 * question stores the chosen option's value. */
export type NodeAnswers = Record<string, boolean | string>;

function ruleMatches(rule: RedFlagRule, capture: InitialCapture): boolean {
  if (rule.onset && rule.onset !== capture.onset) return false;
  if (rule.minSeverity !== undefined && capture.severity < rule.minSeverity) return false;
  if (rule.anyAssociatedSymptom && !rule.anyAssociatedSymptom.some((s) => capture.associatedSymptoms.includes(s))) {
    return false;
  }
  if (rule.allAssociatedSymptoms && !rule.allAssociatedSymptoms.every((s) => capture.associatedSymptoms.includes(s))) {
    return false;
  }
  if (rule.anyHistory && !rule.anyHistory.some((h) => capture.history.includes(h))) return false;
  if (rule.anyTrigger && !rule.anyTrigger.some((t) => capture.triggers.includes(t))) return false;
  if (rule.measurementBelow) {
    const value = capture.measurements[rule.measurementBelow.key];
    if (value === undefined || value >= rule.measurementBelow.value) return false;
  }
  return true;
}

/**
 * Runs BEFORE a single node-graph question is asked -- same "deterministic
 * backstop always wins" discipline as ai-coach's keyword-guardrail, just
 * over structured data instead of regex over free text (harder to game,
 * since these are fixed checklists/sliders, not open text). Returns the
 * first matching rule, or null if none match.
 */
export function evaluateRedFlags(pathway: TriagePathway, capture: InitialCapture): RedFlagScreenEntry | null {
  return pathway.redFlagScreen.find((entry) => ruleMatches(entry.rule, capture)) ?? null;
}

export type TriageStep =
  | { type: "question"; node: QuestionNode }
  | { type: "outcome"; node: OutcomeNode; reachedByFallback: boolean };

/**
 * Walks the pathway's node graph from startNodeKey using whatever answers
 * have been given so far. Returns the next question to ask, or the outcome
 * once the graph resolves one. A missing/unrecognised answer or a broken
 * edge lands on fallbackOutcome (clinicianReviewRequired: true by protocol
 * convention) rather than guessing -- "route to human review as a safety
 * default" per every pathway's own fallbackOutcome.rationale.
 */
export function nextTriageStep(pathway: TriagePathway, answers: NodeAnswers): TriageStep {
  let currentKey = pathway.startNodeKey;
  const visited = new Set<string>();

  for (let i = 0; i < pathway.redFlagScreen.length + Object.keys(pathway.nodes).length + 1; i++) {
    if (visited.has(currentKey)) return { type: "outcome", node: pathway.fallbackOutcome, reachedByFallback: true };
    visited.add(currentKey);

    const node = pathway.nodes[currentKey];
    if (!node) return { type: "outcome", node: pathway.fallbackOutcome, reachedByFallback: true };

    if (node.type === "outcome") return { type: "outcome", node, reachedByFallback: false };

    const answer = answers[node.key];
    if (answer === undefined) return { type: "question", node };

    if (node.kind === "boolean") {
      if (typeof answer !== "boolean") return { type: "outcome", node: pathway.fallbackOutcome, reachedByFallback: true };
      currentKey = answer ? node.onYes : node.onNo;
      continue;
    }

    const option = node.options.find((o) => o.value === answer);
    if (!option) return { type: "outcome", node: pathway.fallbackOutcome, reachedByFallback: true };
    currentKey = option.next;
  }

  return { type: "outcome", node: pathway.fallbackOutcome, reachedByFallback: true };
}

/** Full disposition for a pathway given a complete initial capture and (if
 * no red flag fired) the node-graph answers -- the single entry point the
 * server action re-runs independently of whatever the client believed the
 * outcome was, so the persisted category is never client-trusted. */
export function resolveTriageDisposition(
  pathway: TriagePathway,
  capture: InitialCapture,
  answers: NodeAnswers
): { redFlag: RedFlagScreenEntry | null; outcome: OutcomeNode } {
  const redFlag = evaluateRedFlags(pathway, capture);
  if (redFlag) {
    return {
      redFlag,
      outcome: {
        type: "outcome",
        key: `red_flag:${redFlag.key}`,
        category: redFlag.category,
        rationale: `Matched red-flag screen: ${redFlag.label}.`,
        safetyNetMessageKey: "generic.red_flag",
        clinicianReviewRequired: redFlag.category !== "self_management",
      },
    };
  }

  const step = nextTriageStep(pathway, answers);
  if (step.type === "question") {
    throw new Error("resolveTriageDisposition called with an incomplete answer set");
  }
  return { redFlag: null, outcome: step.node };
}

/** PathwayNode keys referenced by a measurementBelow rule, e.g. "spo2_pct" --
 * lets the initial-capture UI render an optional numeric field only for
 * pathways whose protocol actually asks for one, without hardcoding which
 * pathways those are. */
export function measurementKeysForPathway(pathway: TriagePathway): string[] {
  const keys = new Set<string>();
  for (const entry of pathway.redFlagScreen) {
    if (entry.rule.measurementBelow) keys.add(entry.rule.measurementBelow.key);
  }
  return [...keys];
}
