import { describe, expect, it } from "@jest/globals";
import {
  evaluateRedFlags,
  measurementKeysForPathway,
  nextTriageStep,
  resolveTriageDisposition,
  type NodeAnswers,
} from "./engine";
import type { InitialCapture, TriagePathway } from "./types";

function capture(overrides: Partial<InitialCapture> = {}): InitialCapture {
  return {
    severity: 3,
    onset: "gradual",
    associatedSymptoms: [],
    history: [],
    triggers: [],
    measurements: {},
    ...overrides,
  };
}

/** A small fixture pathway with the same shape as the live headache
 * protocol, trimmed to what these tests need -- not a copy of the live
 * clinical content, which lives only in the signed triage_protocols row. */
function fixturePathway(): TriagePathway {
  return {
    key: "test_symptom",
    label: "Test symptom",
    startNodeKey: "severity_check",
    nodes: {
      severity_check: {
        type: "question",
        kind: "choice",
        key: "severity_check",
        prompt: "How bad is it?",
        options: [
          { value: "mild", label: "Mild", next: "outcome_self" },
          { value: "severe", label: "Severe", next: "duration_check" },
        ],
      },
      duration_check: {
        type: "question",
        kind: "boolean",
        key: "duration_check",
        prompt: "More than 3 days?",
        onYes: "outcome_routine",
        onNo: "outcome_urgent",
      },
      outcome_self: {
        type: "outcome",
        key: "outcome_self",
        category: "self_management",
        rationale: "Mild, non-red-flag.",
        safetyNetMessageKey: "test.self",
        clinicianReviewRequired: false,
      },
      outcome_routine: {
        type: "outcome",
        key: "outcome_routine",
        category: "routine",
        rationale: "Persistent but not urgent.",
        safetyNetMessageKey: "test.routine",
        clinicianReviewRequired: false,
      },
      outcome_urgent: {
        type: "outcome",
        key: "outcome_urgent",
        category: "urgent",
        rationale: "New and severe.",
        safetyNetMessageKey: "test.urgent",
        clinicianReviewRequired: false,
      },
    },
    redFlagScreen: [
      {
        key: "test.sudden_severe",
        label: "Sudden, severe onset",
        category: "emergency",
        rule: { onset: "sudden", minSeverity: 8 },
      },
      {
        key: "test.with_confusion",
        label: "With confusion",
        category: "emergency",
        rule: { anyAssociatedSymptom: ["confusion"] },
      },
      {
        key: "test.low_spo2",
        label: "Low oxygen saturation",
        category: "emergency",
        rule: { measurementBelow: { key: "spo2_pct", value: 92 } },
      },
    ],
    fallbackOutcome: {
      type: "outcome",
      key: "fallback",
      category: "urgent",
      rationale: "Reached an unexpected state -- routed to human review as a safety default.",
      safetyNetMessageKey: "generic.fallback_review",
      clinicianReviewRequired: true,
    },
    knownHistory: [],
    knownTriggers: [],
    knownAssociatedSymptoms: ["confusion", "fever"],
  };
}

describe("evaluateRedFlags", () => {
  it("matches a rule requiring both sudden onset and a severity floor", () => {
    const match = evaluateRedFlags(fixturePathway(), capture({ onset: "sudden", severity: 9 }));
    expect(match?.key).toBe("test.sudden_severe");
  });

  it("does not match when severity is below the floor even with the right onset", () => {
    const match = evaluateRedFlags(fixturePathway(), capture({ onset: "sudden", severity: 5 }));
    expect(match).toBeNull();
  });

  it("matches an associated-symptom rule", () => {
    const match = evaluateRedFlags(fixturePathway(), capture({ associatedSymptoms: ["confusion"] }));
    expect(match?.key).toBe("test.with_confusion");
  });

  it("matches a measurementBelow rule strictly below the threshold, not at it", () => {
    expect(evaluateRedFlags(fixturePathway(), capture({ measurements: { spo2_pct: 91 } }))?.key).toBe(
      "test.low_spo2"
    );
    expect(evaluateRedFlags(fixturePathway(), capture({ measurements: { spo2_pct: 92 } }))).toBeNull();
  });

  it("returns null when nothing matches, rather than false reassurance masquerading as no signal", () => {
    expect(evaluateRedFlags(fixturePathway(), capture())).toBeNull();
  });
});

describe("nextTriageStep", () => {
  it("asks the start node's question when no answers are given yet", () => {
    const step = nextTriageStep(fixturePathway(), {});
    expect(step.type).toBe("question");
    if (step.type === "question") expect(step.node.key).toBe("severity_check");
  });

  it("walks a choice branch to its outcome", () => {
    const answers: NodeAnswers = { severity_check: "mild" };
    const step = nextTriageStep(fixturePathway(), answers);
    expect(step).toEqual({
      type: "outcome",
      node: fixturePathway().nodes.outcome_self,
      reachedByFallback: false,
    });
  });

  it("walks through a boolean node after a choice node", () => {
    const step = nextTriageStep(fixturePathway(), { severity_check: "severe" });
    expect(step.type).toBe("question");
    if (step.type === "question") expect(step.node.key).toBe("duration_check");
  });

  it("resolves a full two-step path to the correct outcome", () => {
    const step = nextTriageStep(fixturePathway(), { severity_check: "severe", duration_check: false });
    expect(step.type).toBe("outcome");
    if (step.type === "outcome") expect(step.node.key).toBe("outcome_urgent");
  });

  it("falls back to human review on an answer that doesn't match the node's own type", () => {
    const step = nextTriageStep(fixturePathway(), { severity_check: true as unknown as string });
    expect(step.type).toBe("outcome");
    if (step.type === "outcome") {
      expect(step.node.key).toBe("fallback");
      expect(step.reachedByFallback).toBe(true);
    }
  });

  it("falls back to human review on an unrecognised choice value, rather than guessing", () => {
    const step = nextTriageStep(fixturePathway(), { severity_check: "not_a_real_option" });
    expect(step.type).toBe("outcome");
    if (step.type === "outcome") expect(step.node.key).toBe("fallback");
  });
});

describe("resolveTriageDisposition", () => {
  it("short-circuits to the red flag's outcome without needing any node-graph answers", () => {
    const { redFlag, outcome } = resolveTriageDisposition(
      fixturePathway(),
      capture({ onset: "sudden", severity: 9 }),
      {}
    );
    expect(redFlag?.key).toBe("test.sudden_severe");
    expect(outcome.category).toBe("emergency");
    expect(outcome.clinicianReviewRequired).toBe(true);
  });

  it("falls through to the node graph when no red flag matches", () => {
    const { redFlag, outcome } = resolveTriageDisposition(fixturePathway(), capture(), {
      severity_check: "mild",
    });
    expect(redFlag).toBeNull();
    expect(outcome.key).toBe("outcome_self");
  });

  it("throws rather than silently guessing when the answer set is incomplete", () => {
    expect(() => resolveTriageDisposition(fixturePathway(), capture(), {})).toThrow();
  });
});

describe("measurementKeysForPathway", () => {
  it("collects every distinct measurementBelow key referenced by the red-flag screen", () => {
    expect(measurementKeysForPathway(fixturePathway())).toEqual(["spo2_pct"]);
  });

  it("returns an empty array for a pathway with no measurement-based red flags", () => {
    const pathway = fixturePathway();
    pathway.redFlagScreen = pathway.redFlagScreen.filter((r) => !r.rule.measurementBelow);
    expect(measurementKeysForPathway(pathway)).toEqual([]);
  });
});
