import { describe, it, expect } from "@jest/globals";
import {
  proposeNextAction,
  applyGuardrails,
  decideCoachingAction,
  type ProgrammeSignals,
} from "./index";

const CALM: ProgrammeSignals = {
  isPaused: false,
  hasOpenRedFlag: false,
  disengagementRisk: 0.1,
  daysSinceLastLog: 1,
  plateauDetected: false,
};

describe("coaching agent — proposals", () => {
  it("nudges a disengaging patient", () => {
    expect(proposeNextAction({ ...CALM, disengagementRisk: 0.8 }).kind).toBe("send_nudge");
    expect(proposeNextAction({ ...CALM, daysSinceLastLog: 9 }).kind).toBe("send_nudge");
  });
  it("adjusts difficulty on a plateau", () => {
    expect(proposeNextAction({ ...CALM, plateauDetected: true }).kind).toBe(
      "adjust_task_difficulty",
    );
  });
  it("surfaces content on steady progress", () => {
    expect(proposeNextAction(CALM).kind).toBe("surface_content");
  });
});

describe("coaching agent — HARD guardrails (spec §18.7)", () => {
  it("a paused programme can ONLY route to a doctor, never nudge", () => {
    // Even a disengaged, paused patient must not be nudged toward goals.
    const signals = { ...CALM, isPaused: true, disengagementRisk: 0.9 };
    expect(decideCoachingAction(signals).kind).toBe("request_doctor_review");
  });

  it("an open red flag routes to a doctor", () => {
    expect(decideCoachingAction({ ...CALM, hasOpenRedFlag: true }).kind).toBe(
      "request_doctor_review",
    );
  });

  it("guardrail overrides a (hypothetical LLM) nudge proposal on a paused programme", () => {
    const forced = applyGuardrails(
      { kind: "send_nudge", reason: "llm_said_so" },
      { ...CALM, isPaused: true },
    );
    expect(forced.overridden).toBe(true);
    expect(forced.action.kind).toBe("request_doctor_review");
  });

  it("leaves a safe proposal untouched", () => {
    const r = applyGuardrails({ kind: "surface_content", reason: "ok" }, CALM);
    expect(r.overridden).toBe(false);
    expect(r.action.kind).toBe("surface_content");
  });
});
