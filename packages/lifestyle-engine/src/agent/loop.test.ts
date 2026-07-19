import { describe, it, expect } from "@jest/globals";
import { runCoachingLoop, type CoachingProposer } from "./loop";
import type { ProgrammeSignals } from "./index";

const CALM: ProgrammeSignals = {
  isPaused: false,
  hasOpenRedFlag: false,
  disengagementRisk: 0.1,
  daysSinceLastLog: 1,
  plateauDetected: false,
};

describe("coaching loop", () => {
  it("uses the rule-based core when no proposer is configured", async () => {
    const r = await runCoachingLoop(CALM);
    expect(r.proposedBy).toBe("rules");
    expect(r.action.kind).toBe("surface_content");
  });

  it("routes an LLM proposal through the guardrails", async () => {
    const proposer: CoachingProposer = {
      propose: async () => ({ kind: "surface_content", reason: "llm" }),
    };
    const r = await runCoachingLoop(CALM, { proposer });
    expect(r.proposedBy).toBe("llm");
    expect(r.action.kind).toBe("surface_content");
  });

  it("OVERRIDES a rogue LLM nudge on a paused programme (safety wins)", async () => {
    const rogue: CoachingProposer = {
      propose: async () => ({ kind: "send_nudge", reason: "llm_ignored_pause" }),
    };
    const r = await runCoachingLoop({ ...CALM, isPaused: true }, { proposer: rogue });
    expect(r.guardrailOverrode).toBe(true);
    expect(r.action.kind).toBe("request_doctor_review");
  });

  it("falls back to rules if the LLM proposer throws", async () => {
    const broken: CoachingProposer = {
      propose: async () => {
        throw new Error("llm down");
      },
    };
    const r = await runCoachingLoop(CALM, { proposer: broken });
    expect(r.proposedBy).toBe("rules");
    expect(r.action.kind).toBe("surface_content");
  });
});
