import { describe, it, expect, jest } from "@jest/globals";
import type { ChatAnthropic } from "@langchain/anthropic";
import { runCoachingLoop } from "@tarragon/lifestyle-engine";
import type { ProgrammeSignals } from "@tarragon/lifestyle-engine";
import { createLifestyleCoachingProposer } from "./coaching-proposer";

// Mocked so this pure-logic test never has to resolve/construct a real
// ChatAnthropic client — createLifestyleCoachingProposer only calls
// buildAnthropicModel() when no `opts.model` is supplied, and every case
// below supplies one, but the module import itself still has to resolve.
jest.mock("@/lib/ai-coach/model", () => ({ buildAnthropicModel: jest.fn() }));

const CALM: ProgrammeSignals = {
  isPaused: false,
  hasOpenRedFlag: false,
  disengagementRisk: 0.1,
  daysSinceLastLog: 1,
  plateauDetected: false,
};

const CONTEXT = {
  condition: "obesity" as const,
  conditionLabel: "Weight & lifestyle",
  programmeName: "Obesity programme",
  currentPhaseName: "Foundation",
  goalTitles: ["Daily walk"],
  recentWeightKg: [],
};

function fakeModel(reply: () => Promise<{ message: string }>): ChatAnthropic {
  return {
    withStructuredOutput: () => ({ invoke: reply }),
  } as unknown as ChatAnthropic;
}

describe("createLifestyleCoachingProposer", () => {
  it("never calls the model when the deterministic action isn't send_nudge", async () => {
    const invoke = jest.fn(async () => ({ message: "should not be called" }));
    const proposer = createLifestyleCoachingProposer(CONTEXT, { model: fakeModel(invoke) });

    const action = await proposer.propose(CALM); // steady progress -> surface_content

    expect(action.kind).toBe("surface_content");
    expect(action.message).toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("attaches a personalised message on top of a deterministic send_nudge", async () => {
    const proposer = createLifestyleCoachingProposer(CONTEXT, {
      model: fakeModel(async () => ({ message: "Small steps still count — how's the walk going?" })),
    });

    const disengaged = { ...CALM, disengagementRisk: 0.9 };
    const action = await proposer.propose(disengaged);

    expect(action.kind).toBe("send_nudge");
    expect(action.message).toBe("Small steps still count — how's the walk going?");
  });

  it("falls back to the bare deterministic action when the model call throws", async () => {
    const proposer = createLifestyleCoachingProposer(CONTEXT, {
      model: fakeModel(async () => {
        throw new Error("model unreachable");
      }),
    });

    const disengaged = { ...CALM, disengagementRisk: 0.9 };
    const action = await proposer.propose(disengaged);

    expect(action.kind).toBe("send_nudge");
    expect(action.message).toBeUndefined();
  });

  it("never asks the model to nudge a paused programme, and the wrapped loop lands on request_doctor_review", async () => {
    // Because `kind` is decided by proposeNextAction() before the model is
    // ever consulted (see coaching-proposer.ts), the LLM is structurally
    // unable to propose send_nudge for a paused programme in the first
    // place — there's no "rogue nudge" for applyGuardrails to catch here,
    // unlike a proposer that lets the LLM pick `kind` freely. Prove both
    // halves: the model is never invoked, and the full runCoachingLoop path
    // still lands on request_doctor_review either way.
    const invoke = jest.fn(async () => ({ message: "Keep pushing toward your goal!" }));
    const proposer = createLifestyleCoachingProposer(CONTEXT, { model: fakeModel(invoke) });

    const paused = { ...CALM, isPaused: true, disengagementRisk: 0.9 };
    const r = await runCoachingLoop(paused, { proposer });

    expect(r.action.kind).toBe("request_doctor_review");
    expect(r.action.message).toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("still produces a nudge when reference-material retrieval fails", async () => {
    // embedder+supabase ARE provided (unlike the tests above, which omit
    // them and skip retrieval entirely) — this proves a failure *inside*
    // retrieval doesn't take the whole nudge down with it, not just that
    // omitting retrieval is safe.
    const proposer = createLifestyleCoachingProposer(CONTEXT, {
      model: fakeModel(async () => ({ message: "Small steps still count today." })),
      embedder: {
        embed: async () => {
          throw new Error("Voyage unreachable");
        },
      },
      supabase: {} as never, // never dereferenced before embed() throws
    });

    const disengaged = { ...CALM, disengagementRisk: 0.9 };
    const action = await proposer.propose(disengaged);

    expect(action.kind).toBe("send_nudge");
    expect(action.message).toBe("Small steps still count today.");
  });
});
