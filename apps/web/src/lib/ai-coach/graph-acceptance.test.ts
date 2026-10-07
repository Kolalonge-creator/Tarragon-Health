/**
 * Graph-level acceptance tests for the assistant (spec B.7). The model is a stub that fails the test if it is touched,
 * so "no model call" is proved, not assumed.
 */
import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatAnthropic } from "@langchain/anthropic";
import type { Database } from "@tarragon/shared";

const logAiCoachEscalation = jest.fn(async () => ({ clinicianAlertId: "a1", escalationId: "e1", careMessageThreadId: "t1" }));
const logAiCoachReviewFlag = jest.fn(async () => ({ clinicianAlertId: "a2" }));
jest.mock("./escalate", () => ({ logAiCoachEscalation, logAiCoachReviewFlag }));

import { buildCoachGraph } from "./graph";
import { EMERGENCY_SAFETY_REPLY } from "./prompts";
import { SENSITIVE_RESULT_REPLY } from "./reply-screen";

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

describe("INV-04: the assistant never discusses a sensitive result", () => {
  it.each(["what does my HIV test result mean", "my hepatitis B came back positive", "explain my HBsAg result"])(
    "%s gets the fixed care-team reply with no model call",
    async (incomingMessage) => {
      const { graph, touched } = deps();
      const out = await graph.invoke({ ...base, incomingMessage });
      expect(out.reply).toBe(SENSITIVE_RESULT_REPLY);
      expect(out.tier).toBe("clinician_review");
      expect(out.modelId).toBeNull();
      expect(touched).not.toHaveBeenCalled();
      expect(logAiCoachReviewFlag).toHaveBeenCalled();
    }
  );
});

describe("emergency wording still short-circuits the model", () => {
  it("chest pain returns the emergency reply with no model call", async () => {
    const { graph, touched } = deps();
    const out = await graph.invoke({ ...base, incomingMessage: "I have chest pain" });
    expect(out.reply).toBe(EMERGENCY_SAFETY_REPLY);
    expect(touched).not.toHaveBeenCalled();
  });
});
