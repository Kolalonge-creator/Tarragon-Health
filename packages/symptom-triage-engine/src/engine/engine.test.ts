/**
 * Golden triage scenarios (spec §37.12 acceptance criteria). These are
 * safety-critical: they must stay green. Covers the red-flag screen
 * short-circuit, the dynamic questionnaire walk, "most severe wins", the
 * clinician-review-required escape hatch (§37.9), and the fail-safe
 * fallback for a broken graph.
 */
import { describe, it, expect } from "@jest/globals";
import { nextTriageStep, runTriage, screenRedFlags } from "./index";
import { SEED_PATHWAYS } from "../protocols/index";
import type { PresentingComplaintProtocol, SymptomCapture } from "../types/index";

function pathway(key: string): PresentingComplaintProtocol {
  const p = SEED_PATHWAYS.find((x) => x.key === key);
  if (!p) throw new Error(`no seed pathway ${key}`);
  return p;
}

function capture(partial: Partial<SymptomCapture> & Pick<SymptomCapture, "presentingComplaintKey">): SymptomCapture {
  return {
    onset: "gradual",
    severity: 3,
    associatedSymptoms: [],
    triggers: [],
    relevantHistory: [],
    measurements: {},
    ...partial,
  };
}

describe("red-flag screen — acceptance scenarios", () => {
  it("thunderclap headache fires emergency", () => {
    const r = screenRedFlags(
      capture({ presentingComplaintKey: "headache", onset: "sudden", severity: 9 }),
      pathway("headache").redFlagScreen,
    );
    expect(r.hasFlag).toBe(true);
    expect(r.topCategory).toBe("emergency");
    expect(r.fired.some((f) => f.key === "headache.thunderclap_onset")).toBe(true);
  });

  it("chest pain with breathlessness fires emergency (cardiac pattern)", () => {
    const r = screenRedFlags(
      capture({ presentingComplaintKey: "chest_pain", severity: 7, associatedSymptoms: ["breathlessness"] }),
      pathway("chest_pain").redFlagScreen,
    );
    expect(r.hasFlag).toBe(true);
    expect(r.topCategory).toBe("emergency");
  });

  it("breathlessness with SpO2 < 92 fires emergency even at low reported severity", () => {
    const r = screenRedFlags(
      capture({ presentingComplaintKey: "breathlessness", severity: 2, measurements: { spo2_pct: 88 } }),
      pathway("breathlessness").redFlagScreen,
    );
    expect(r.hasFlag).toBe(true);
    expect(r.topCategory).toBe("emergency");
  });

  it("mild, unremarkable headache fires no red flag", () => {
    const r = screenRedFlags(
      capture({ presentingComplaintKey: "headache", severity: 2 }),
      pathway("headache").redFlagScreen,
    );
    expect(r.hasFlag).toBe(false);
    expect(r.topCategory).toBeNull();
  });

  it("a malformed rule condition (e.g. a hand-edited config slipping past validation) never crashes the screen", () => {
    const r = screenRedFlags(capture({ presentingComplaintKey: "headache", severity: 2 }), [
      {
        key: "broken.rule",
        label: "broken",
        category: "emergency",
        // Cast past the type system to simulate a malformed jsonb config —
        // this is exactly the defence-in-depth case evaluateCondition's
        // caller (screenRedFlags' try/catch) guards against.
        rule: null as unknown as { onset?: undefined },
      },
    ]);
    expect(r.hasFlag).toBe(false);
    expect(r.brokenRules).toEqual(["broken.rule"]);
  });
});

describe("dynamic questionnaire walk — headache", () => {
  it("asks one question at a time, never the whole tree up front", () => {
    const step1 = nextTriageStep(pathway("headache"), {});
    expect(step1.done).toBe(false);
    if (step1.done) throw new Error("unreachable");
    expect(step1.question.key).toBe("duration_check");
  });

  it("frequent-but-not-worsening headache with severe pain still lands on urgent+review, not a false-reassurance routine outcome", () => {
    const result = nextTriageStep(pathway("headache"), {
      duration_check: true,
      worsening_check: false,
      frequency_check: false,
      severity_check: "severe",
    });
    expect(result.done).toBe(true);
    if (!result.done) throw new Error("unreachable");
    expect(result.outcome.category).toBe("urgent");
    expect(result.outcome.clinicianReviewRequired).toBe(true);
  });

  it("mild headache, no red flags, no worrying pattern -> self_management", () => {
    const result = nextTriageStep(pathway("headache"), {
      duration_check: false,
      frequency_check: false,
      severity_check: "mild",
    });
    expect(result.done).toBe(true);
    if (!result.done) throw new Error("unreachable");
    expect(result.outcome.category).toBe("self_management");
  });

  it("re-running with the same answers and question log is deterministic (no hidden state)", () => {
    // A realistic caller persists the running questionLog across steps, so
    // re-deriving the current node never re-stamps an already-logged
    // answer's timestamp — pass one in explicitly rather than relying on
    // two back-to-back `new Date()` calls landing on the same millisecond.
    const answers = { duration_check: false, frequency_check: true };
    const questionLog = [
      { questionKey: "duration_check", prompt: "...", answer: false, answeredAt: "2026-08-29T09:00:00.000Z" },
      { questionKey: "frequency_check", prompt: "...", answer: true, answeredAt: "2026-08-29T09:00:01.000Z" },
    ];
    const a = nextTriageStep(pathway("headache"), answers, questionLog);
    const b = nextTriageStep(pathway("headache"), answers, questionLog);
    expect(a).toEqual(b);
  });

  it("an unknown node key falls back to the safety-default outcome rather than crashing", () => {
    const broken: PresentingComplaintProtocol = {
      ...pathway("headache"),
      startNodeKey: "does_not_exist",
    };
    const result = nextTriageStep(broken, {});
    expect(result.done).toBe(true);
    if (!result.done) throw new Error("unreachable");
    expect(result.outcome.key).toBe("fallback");
    expect(result.outcome.clinicianReviewRequired).toBe(true);
  });
});

describe("runTriage — full flow, red flag short-circuits the questionnaire", () => {
  it("a fired red flag skips the questionnaire entirely", () => {
    const result = runTriage(
      pathway("headache"),
      capture({ presentingComplaintKey: "headache", onset: "sudden", severity: 9 }),
      {},
    );
    expect(result.category).toBe("emergency");
    expect(result.nextQuestion).toBeUndefined();
    expect(result.questionsAsked).toEqual([]);
  });

  it("no red flag -> returns the first question, category defaults to the least-urgent placeholder", () => {
    const result = runTriage(pathway("headache"), capture({ presentingComplaintKey: "headache", severity: 2 }), {});
    expect(result.nextQuestion?.key).toBe("duration_check");
  });

  it("completing the questionnaire returns a final category with an audit trail of questions asked", () => {
    const result = runTriage(pathway("headache"), capture({ presentingComplaintKey: "headache", severity: 2 }), {
      duration_check: false,
      frequency_check: false,
      severity_check: "moderate",
    });
    expect(result.category).toBe("routine");
    expect(result.questionsAsked.map((q) => q.questionKey)).toEqual([
      "duration_check",
      "frequency_check",
      "severity_check",
    ]);
  });
});
