/**
 * Found in review: while assistant_enabled is closed, an emergency message must still get the fixed emergency guidance and the same
 * escalation, never "the assistant is not open yet". The red-flag screen is a safety net, not a feature.
 */
import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

const logAiCoachEscalation = jest.fn(async () => ({ clinicianAlertId: "a1", escalationId: "e1", careMessageThreadId: "t1" }));
const appendMessages = jest.fn(async () => undefined);
const logAssistantTurn = jest.fn(async () => undefined);
const emitAssistantEvent = jest.fn(async () => true);
jest.mock("./escalate", () => ({ logAiCoachEscalation, logAiCoachReviewFlag: jest.fn() }));
jest.mock("./conversation-store", () => ({
  appendMessages,
  resolveOrCreateConversation: jest.fn(async () => ({ conversationId: "c1", fullMessages: [] })),
}));
jest.mock("./audit", () => ({ logAssistantTurn }));
jest.mock("./events", () => ({ emitAssistantEvent }));

import { runCoachTurn } from "./index";
import { ASSISTANT_NOT_OPEN_REPLY } from "./guard";
import { EMERGENCY_SAFETY_REPLY } from "./prompts";

function closedClient() {
  const rpc = jest.fn(async () => ({ data: false, error: null }));
  const supabase = { rpc, from: jest.fn() } as unknown as SupabaseClient<Database>;
  return supabase;
}
const base = { profileId: "p1", organisationId: "o1", getServiceRoleSupabase: () => ({}) as unknown as SupabaseClient<Database> };

describe("a closed assistant never swallows an emergency", () => {
  it("answers an emergency with the fixed copy, escalates, saves the turn and records the event", async () => {
    const out = await runCoachTurn({ ...base, supabase: closedClient(), message: "I have crushing chest pain" });
    expect(out.reply).toBe(EMERGENCY_SAFETY_REPLY);
    expect(out.tier).toBe("emergency");
    expect(out.notOpen).toBeUndefined();
    expect(logAiCoachEscalation).toHaveBeenCalled();
    expect(appendMessages).toHaveBeenCalled();
    expect(logAssistantTurn).toHaveBeenCalled();
    expect(emitAssistantEvent).toHaveBeenCalled();
  });

  it("a scheduling question still gets the plain 'not open yet'", async () => {
    logAiCoachEscalation.mockClear();
    const out = await runCoachTurn({ ...base, supabase: closedClient(), message: "when is my next appointment" });
    expect(out.reply).toBe(ASSISTANT_NOT_OPEN_REPLY);
    expect(out.notOpen).toBe(true);
    expect(logAiCoachEscalation).not.toHaveBeenCalled();
  });

  it("an escalation that fails does not withhold the emergency copy", async () => {
    logAiCoachEscalation.mockRejectedValueOnce(new Error("db down"));
    const out = await runCoachTurn({ ...base, supabase: closedClient(), message: "I can't breathe" });
    expect(out.reply).toBe(EMERGENCY_SAFETY_REPLY);
  });
});
