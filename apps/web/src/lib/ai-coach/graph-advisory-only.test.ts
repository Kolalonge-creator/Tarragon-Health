/**
 * W-10: with AI-001 restricted to advisory display, ANSWERS are restricted and alerts are not. Clinician alerts still open exactly as before,
 * model answers carry the fixed note, and a question asking for specific advice about the patient's own care goes to the care team.
 * Emergency and keyword-guardrail paths are unchanged. The model is the only stub.
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
import { ADVISORY_NOTE, CARE_TEAM_REDIRECT_REPLY } from "./advisory";

function stubModel(structured: Record<string, unknown>) {
  const touched = jest.fn();
  const model = {
    bindTools: () => ({ invoke: async () => ({ tool_calls: [] }) }),
    withStructuredOutput: () => ({
      invoke: async () => {
        touched();
        return structured;
      },
    }),
  } as unknown as ChatAnthropic;
  return { model, touched };
}

const base = { profileId: "p1", organisationId: "o1", conversationId: "c1", priorMessages: [] };

function build(advisoryOnly: boolean | undefined, structured: Record<string, unknown>) {
  const insert = jest.fn(async (_row: Record<string, unknown>) => ({ error: null }));
  const supabase = { from: jest.fn(() => ({ insert })), rpc: jest.fn() } as unknown as SupabaseClient<Database>;
  const { model, touched } = stubModel(structured);
  const graph = buildCoachGraph({ supabase, getServiceRoleSupabase: () => supabase, model, advisoryOnly });
  return { graph, touched };
}

const routineTurn = { tier: "routine", reply: "A short daily walk is a gentle way to start.", suggestedAction: "none", isHealthInformationRequest: false };
const reviewTurn = { tier: "clinician_review", reply: "A doctor on your care team should look at this.", suggestedAction: "none", isHealthInformationRequest: false };
const message = "my ankles have been a bit puffy lately and I feel tired";

describe("AI-001 restricted to advisory display (W-10)", () => {
  it("a clinician_review turn still opens a clinician alert in advisory mode, exactly as before", async () => {
    logAiCoachReviewFlag.mockClear();
    const { graph } = build(true, reviewTurn);
    const out = await graph.invoke({ ...base, incomingMessage: message });
    expect(out.tier).toBe("clinician_review");
    expect(logAiCoachReviewFlag).toHaveBeenCalledTimes(1);
    expect(out.reply).toContain(ADVISORY_NOTE);
  });

  it("unrestricted: the same turn opens the alert and carries no note", async () => {
    logAiCoachReviewFlag.mockClear();
    const { graph } = build(false, reviewTurn);
    const out = await graph.invoke({ ...base, incomingMessage: message });
    expect(logAiCoachReviewFlag).toHaveBeenCalledTimes(1);
    expect(out.reply).not.toContain(ADVISORY_NOTE);
  });

  it("a model-written answer carries the fixed note in advisory mode", async () => {
    const { graph } = build(true, routineTurn);
    const out = await graph.invoke({ ...base, incomingMessage: "I walked to the market today" });
    expect(out.tier).toBe("routine");
    expect(out.reply).toContain(routineTurn.reply);
    expect(out.reply.endsWith(ADVISORY_NOTE)).toBe(true);
  });

  it("a question about the patient's own medicines goes to the care team, and the model is not reached", async () => {
    const { graph, touched } = build(true, routineTurn);
    const out = await graph.invoke({ ...base, incomingMessage: "should I take my blood pressure tablets with food" });
    expect(out.reply).toBe(CARE_TEAM_REDIRECT_REPLY);
    expect(touched).not.toHaveBeenCalled();
  });

  it("the same question reaches the model when the coach is not restricted", async () => {
    const { graph, touched } = build(false, routineTurn);
    await graph.invoke({ ...base, incomingMessage: "should I take my blood pressure tablets with food" });
    expect(touched).toHaveBeenCalled();
  });

  it("the deterministic sensitive-result screen and dose refusal are unchanged and still flag the care team", async () => {
    logAiCoachReviewFlag.mockClear();
    const { graph } = build(true, routineTurn);
    await graph.invoke({ ...base, incomingMessage: "what does my HIV test result mean" });
    await graph.invoke({ ...base, incomingMessage: "I want to stop my tablets" });
    expect(logAiCoachReviewFlag).toHaveBeenCalledTimes(2);
  });

  it("the keyword emergency path still escalates and carries no note", async () => {
    logAiCoachEscalation.mockClear();
    const { graph } = build(true, routineTurn);
    const out = await graph.invoke({ ...base, incomingMessage: "I have chest pain" });
    expect(out.tier).toBe("emergency");
    expect(logAiCoachEscalation).toHaveBeenCalled();
    expect(out.reply).not.toContain(ADVISORY_NOTE);
  });

  it("a model-classified emergency still escalates and carries no note", async () => {
    logAiCoachEscalation.mockClear();
    const { graph } = build(true, { ...reviewTurn, tier: "emergency" });
    const out = await graph.invoke({ ...base, incomingMessage: message });
    expect(out.tier).toBe("emergency");
    expect(logAiCoachEscalation).toHaveBeenCalled();
    expect(out.reply).not.toContain(ADVISORY_NOTE);
  });
});
