/**
 * W-10: with AI-001 restricted to advisory display, the model's own clinician_review classification is still shown and recorded but no
 * longer opens a clinician alert. The deterministic refusal screens and the emergency path are unchanged. The model is the only stub.
 */
import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatAnthropic } from "@langchain/anthropic";
import type { Database } from "@tarragon/shared";

const logAiCoachEscalation = jest.fn(async () => ({ clinicianAlertId: "a1", escalationId: "e1", careMessageThreadId: "t1" }));
const logAiCoachReviewFlag = jest.fn(async () => ({ clinicianAlertId: "a2" }));
jest.mock("./escalate", () => ({ logAiCoachEscalation, logAiCoachReviewFlag }));
jest.mock("./context", () => ({
  loadPatientContext: jest.fn(async () => ({
    demographics: { ageYears: 50, sex: "female" },
    elevatedConditions: [],
    highRiskConditions: [],
    isPregnant: false,
    possibleMinor: false,
    lifestyleProgrammes: [],
  })),
}));
jest.mock("@/lib/lifestyle/find-relevant-content", () => ({ findRelevantLifestyleContent: jest.fn(async () => []) }));
jest.mock("./knowledge-base", () => ({ findRelevantHealthEducationContent: jest.fn(async () => []) }));

import { buildCoachGraph } from "./graph";

function stubModel(structured: Record<string, unknown>) {
  return {
    bindTools: () => ({ invoke: async () => ({ tool_calls: [] }) }),
    withStructuredOutput: () => ({ invoke: async () => structured }),
  } as unknown as ChatAnthropic;
}

const base = { profileId: "p1", organisationId: "o1", conversationId: "c1", priorMessages: [] };

function build(advisoryOnly: boolean | undefined, structured: Record<string, unknown>) {
  const insert = jest.fn(async (_row: Record<string, unknown>) => ({ error: null }));
  const supabase = { from: jest.fn(() => ({ insert })), rpc: jest.fn() } as unknown as SupabaseClient<Database>;
  const graph = buildCoachGraph({ supabase, getServiceRoleSupabase: () => supabase, model: stubModel(structured), advisoryOnly });
  return { graph, insert };
}

const reviewTurn = { tier: "clinician_review", reply: "A doctor on your care team should look at this.", suggestedAction: "none", isHealthInformationRequest: false };
const message = "my ankles have been a bit puffy lately and I feel tired";

describe("AI-001 restricted to advisory display (W-10)", () => {
  it("unrestricted: a model clinician_review turn opens a clinician alert, as before", async () => {
    logAiCoachReviewFlag.mockClear();
    const { graph } = build(undefined, reviewTurn);
    const out = await graph.invoke({ ...base, incomingMessage: message });
    expect(out.tier).toBe("clinician_review");
    expect(logAiCoachReviewFlag).toHaveBeenCalledTimes(1);
  });

  it("advisory only: the patient still sees the reply and an audit row is written, but no clinician alert opens", async () => {
    logAiCoachReviewFlag.mockClear();
    const { graph, insert } = build(true, reviewTurn);
    const out = await graph.invoke({ ...base, incomingMessage: message });
    expect(out.tier).toBe("clinician_review");
    expect(out.reply).toContain("care team");
    expect(logAiCoachReviewFlag).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ action: "ai_coach.clinician_review_advisory_only" }));
  });

  it("advisory only: the deterministic sensitive-result screen still flags the care team", async () => {
    logAiCoachReviewFlag.mockClear();
    const { graph } = build(true, reviewTurn);
    await graph.invoke({ ...base, incomingMessage: "what does my HIV test result mean" });
    expect(logAiCoachReviewFlag).toHaveBeenCalledTimes(1);
  });

  it("advisory only: the keyword emergency path still escalates", async () => {
    logAiCoachEscalation.mockClear();
    const { graph } = build(true, reviewTurn);
    const out = await graph.invoke({ ...base, incomingMessage: "I have chest pain" });
    expect(out.tier).toBe("emergency");
    expect(logAiCoachEscalation).toHaveBeenCalled();
  });

  it("advisory only: a model-classified emergency still escalates", async () => {
    logAiCoachEscalation.mockClear();
    const { graph } = build(true, { ...reviewTurn, tier: "emergency" });
    const out = await graph.invoke({ ...base, incomingMessage: message });
    expect(out.tier).toBe("emergency");
    expect(logAiCoachEscalation).toHaveBeenCalled();
  });
});
