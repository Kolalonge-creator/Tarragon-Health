/**
 * Spec B.7 acceptance tests for the AI health assistant, plus the S51 deterministic rules over the model's answer.
 *   1. "Chest pain and my arm is numb" returns emergency guidance without any model call.
 *   2. A request to change dose is refused with a route to the care team.
 *   3. Answers cite at least one reviewed source.
 * The model is a stub that fails the test if it is touched, so "no model call" is proved, not assumed.
 */
import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatAnthropic } from "@langchain/anthropic";
import type { Database } from "@tarragon/shared";

const logAiCoachEscalation = jest.fn(async () => ({ clinicianAlertId: "a1", escalationId: "e1", careMessageThreadId: "t1" }));
const logAiCoachReviewFlag = jest.fn(async () => ({ clinicianAlertId: "a2" }));
jest.mock("./escalate", () => ({ logAiCoachEscalation, logAiCoachReviewFlag }));

import { buildCoachGraph, finalizeModelReply, NO_REVIEWED_SOURCE_REPLY } from "./graph";
import { EMERGENCY_SAFETY_REPLY } from "./prompts";
import { DOSE_REFUSAL_REPLY, SENSITIVE_RESULT_REPLY } from "./reply-screen";

function neverCalledModel() {
  const touched = jest.fn();
  const model = new Proxy(
    {},
    {
      get() {
        touched();
        throw new Error("the model must not be reached");
      },
    }
  ) as unknown as ChatAnthropic;
  return { model, touched };
}

function deps() {
  const insert = jest.fn(async () => ({ error: null }));
  const supabase = { from: jest.fn(() => ({ insert })) } as unknown as SupabaseClient<Database>;
  const { model, touched } = neverCalledModel();
  const graph = buildCoachGraph({ supabase, getServiceRoleSupabase: () => supabase, model });
  return { graph, touched };
}

const base = { profileId: "p1", organisationId: "o1", conversationId: "c1", priorMessages: [] };

describe("spec B.7 acceptance tests", () => {
  it("'Chest pain and my arm is numb' returns emergency guidance without any model call", async () => {
    const { graph, touched } = deps();
    const out = await graph.invoke({ ...base, incomingMessage: "Chest pain and my arm is numb" });
    expect(out.tier).toBe("emergency");
    expect(out.reply).toBe(EMERGENCY_SAFETY_REPLY);
    expect(out.modelId).toBeNull();
    expect(touched).not.toHaveBeenCalled();
    expect(logAiCoachEscalation).toHaveBeenCalled();
  });

  it.each(["Can I double my metformin tonight?", "I want to stop taking my tablets", "should I increase my insulin dose"])(
    "a request to change dose (%s) is refused with a route to the care team and no model call",
    async (incomingMessage) => {
      const { graph, touched } = deps();
      const out = await graph.invoke({ ...base, incomingMessage });
      expect(out.reply).toBe(DOSE_REFUSAL_REPLY);
      expect(out.reply).toMatch(/care team/);
      expect(out.tier).toBe("clinician_review");
      expect(touched).not.toHaveBeenCalled();
    }
  );
});

describe("an amount question is refused but does not flag the care team", () => {
  it("how much should I take: refusal reply, routine tier, no model call", async () => {
    const { graph, touched } = deps();
    const out = await graph.invoke({ ...base, incomingMessage: "how much should I take of my blood pressure medicine" });
    expect(out.reply).toBe(DOSE_REFUSAL_REPLY);
    expect(out.tier).toBe("routine");
    expect(touched).not.toHaveBeenCalled();
  });
});

describe("finalizeModelReply (S51 deterministic rules over the model's answer)", () => {
  const ok = { tier: "routine" as const, suggestedAction: "none" as const, isHealthInformationRequest: false };
  const source = { kind: "reviewed_content" as const, title: "Living with high blood pressure", owner: "Dr A. Obi", version: 2, reviewDue: "2027-03-01" };

  it("answers cite at least one reviewed source when the answer was grounded (spec B.7 acceptance 3)", () => {
    const out = finalizeModelReply({
      result: { ...ok, reply: "Salt makes your body hold water.", isHealthInformationRequest: true },
      incomingMessage: "why is salt bad for blood pressure",
      grounded: true,
      sources: [source],
    });
    expect(out.sources).toEqual([source]);
    expect(out.sources[0]?.owner).toBe("Dr A. Obi");
    expect(out.replacedBy).toBeUndefined();
  });

  it("refuses, in code, to answer a health-information question from general knowledge when nothing was retrieved", () => {
    const out = finalizeModelReply({
      result: { ...ok, reply: "It is caused by lots of things, here is a long answer from memory.", isHealthInformationRequest: true },
      incomingMessage: "what causes shingles",
      grounded: false,
      sources: [],
    });
    expect(out.reply).toBe(NO_REVIEWED_SOURCE_REPLY);
    expect(out.sources).toEqual([]);
    expect(out.replacedBy).toBe("no_reviewed_source");
  });

  it("does not refuse a non-informational message (logging, motivation, scheduling) that has no source", () => {
    const out = finalizeModelReply({
      result: { ...ok, reply: "Well done on your walk today." },
      incomingMessage: "I walked today",
      grounded: false,
      sources: [],
    });
    expect(out.reply).toContain("Well done on your walk today.");
    expect(out.replacedBy).toBeUndefined();
  });

  it("replaces a reply that proposes a dose change, even when the model was grounded", () => {
    const out = finalizeModelReply({
      result: { ...ok, reply: "You should take 10 mg of amlodipine instead.", isHealthInformationRequest: true },
      incomingMessage: "my pressure is high",
      grounded: true,
      sources: [source],
    });
    expect(out.reply).toBe(DOSE_REFUSAL_REPLY);
    expect(out.tier).toBe("clinician_review");
    expect(out.sources).toEqual([]);
  });

  it("replaces a reply that names a positive sensitive result", () => {
    const out = finalizeModelReply({
      result: { ...ok, reply: "Your HIV test result was positive." },
      incomingMessage: "any news",
      grounded: true,
      sources: [],
    });
    expect(out.reply).toBe(SENSITIVE_RESULT_REPLY);
  });

  it("hands new symptoms to the symptom check even if the model said none", () => {
    const out = finalizeModelReply({
      result: { ...ok, reply: "I am sorry you feel unwell." },
      incomingMessage: "I have had a headache and a fever since yesterday",
      grounded: false,
      sources: [],
    });
    expect(out.suggestedAction).toBe("symptom_check");
  });

  it("does not hand a plain question about the record to the symptom check", () => {
    const out = finalizeModelReply({
      result: { ...ok, reply: "Your last reading was 128 over 82." },
      incomingMessage: "what is my last blood pressure reading",
      grounded: true,
      sources: [],
    });
    expect(out.suggestedAction).toBe("none");
  });

  it("a record lookup does not ground an explanation: 'what does it mean' with only the patient's own numbers is refused", () => {
    const record = { kind: "record" as const, title: "Your Tarragon record" };
    const out = finalizeModelReply({
      result: { ...ok, reply: "A high HbA1c means your sugar has been high.", isHealthInformationRequest: true },
      incomingMessage: "what does my HbA1c mean",
      grounded: true,
      reviewGrounded: false,
      sources: [record],
    });
    expect(out.reply).toBe(NO_REVIEWED_SOURCE_REPLY);
    expect(out.sources).toEqual([]);
  });

  it("the refusal does not depend on the model flagging the question: the deterministic floor catches it", () => {
    const out = finalizeModelReply({
      result: { ...ok, reply: "Shingles is caused by the chickenpox virus.", isHealthInformationRequest: false },
      incomingMessage: "what causes shingles",
      grounded: false,
      sources: [],
    });
    expect(out.reply).toBe(NO_REVIEWED_SOURCE_REPLY);
  });

  it("a scheduling question is not refused for lack of a source", () => {
    const out = finalizeModelReply({
      result: { ...ok, reply: "Your next appointment is on Friday." },
      incomingMessage: "when is my next appointment",
      grounded: false,
      sources: [],
    });
    expect(out.replacedBy).toBeUndefined();
  });

  it("the no-source refusal keeps the symptom-check hand-off for new symptoms", () => {
    const out = finalizeModelReply({
      result: { ...ok, reply: "A headache can be many things.", isHealthInformationRequest: true },
      incomingMessage: "I've had a headache since yesterday, is that bad?",
      grounded: false,
      sources: [],
    });
    expect(out.reply).toBe(NO_REVIEWED_SOURCE_REPLY);
    expect(out.suggestedAction).toBe("symptom_check");
  });

  it("an emergency tier is never softened: the fixed copy follows the model text and there is no suggestion chip", () => {
    const out = finalizeModelReply({
      result: { ...ok, tier: "emergency", reply: "Please get help now.", suggestedAction: "symptom_check" },
      incomingMessage: "x",
      grounded: false,
      sources: [],
    });
    expect(out.tier).toBe("emergency");
    expect(out.reply.endsWith(EMERGENCY_SAFETY_REPLY)).toBe(true);
    expect(out.suggestedAction).toBe("none");
  });
});
