/**
 * Found in review (S52): the access-denied and daily-limit short-circuits ran before any emergency screen, so a patient without the
 * assistant, or one who had used the day's messages, got a canned reply to "I want to kill myself". INV-05/INV-06: the red-flag screen is a
 * safety net, not a feature, and neither a plan nor a counter stands in front of it.
 */
import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

const logAiCoachEscalation = jest.fn(async () => ({ clinicianAlertId: "a1", escalationId: "e1", careMessageThreadId: "t1" }));
const hasCoachAccess = jest.fn(async () => false);
const countMessagesToday = jest.fn(async () => 0);
const pageOnCallForSelfHarm = jest.fn(async () => true);
jest.mock("./escalate", () => ({ logAiCoachEscalation, logAiCoachReviewFlag: jest.fn() }));
jest.mock("./guard", () => ({ isAssistantOpen: jest.fn(async () => true), ASSISTANT_NOT_OPEN_REPLY: "not open" }));
jest.mock("./entitlement", () => ({ hasCoachAccess, COACH_ACCESS_DENIED_REPLY: "no access" }));
jest.mock("./rate-limit", () => ({ countMessagesToday, getCoachDailyLimit: jest.fn(async () => 5), COACH_LIMIT_REACHED_REPLY: "limit reached" }));
jest.mock("./conversation-store", () => ({
  appendMessages: jest.fn(async () => undefined),
  resolveOrCreateConversation: jest.fn(async () => ({ conversationId: "c1", fullMessages: [] })),
}));
jest.mock("./audit", () => ({ logAssistantTurn: jest.fn(async () => undefined) }));
jest.mock("./events", () => ({ emitAssistantEvent: jest.fn(async () => true) }));
jest.mock("./emergency-page", () => ({ pageOnCallForSelfHarm }));
jest.mock("./nearest-hospital", () => ({ emergencyAddendumFor: jest.fn(async () => "") }));

import { runCoachTurn } from "./index";
import { EMERGENCY_SAFETY_REPLY } from "./prompts";
import { SELF_HARM_REPLY } from "@tarragon/shared";

const base = {
  profileId: "p1",
  organisationId: "o1",
  supabase: { rpc: jest.fn(), from: jest.fn() } as unknown as SupabaseClient<Database>,
  getServiceRoleSupabase: () => ({}) as unknown as SupabaseClient<Database>,
};

describe("neither a plan nor the daily limit stands in front of an emergency", () => {
  it("a patient without the assistant still gets the emergency copy and the escalation", async () => {
    hasCoachAccess.mockResolvedValue(false);
    logAiCoachEscalation.mockClear();
    const out = await runCoachTurn({ ...base, message: "I have crushing chest pain" });
    expect(out.reply).toBe(EMERGENCY_SAFETY_REPLY);
    expect(out.tier).toBe("emergency");
    expect(logAiCoachEscalation).toHaveBeenCalled();
  });

  it("a self-harm message at the daily limit gets the self-harm copy and the on-call page", async () => {
    hasCoachAccess.mockResolvedValue(true);
    countMessagesToday.mockResolvedValue(99);
    pageOnCallForSelfHarm.mockClear();
    const out = await runCoachTurn({ ...base, message: "I want to kill myself" });
    expect(out.reply).toBe(SELF_HARM_REPLY);
    expect(pageOnCallForSelfHarm).toHaveBeenCalledTimes(1);
  });

  it("an ordinary message past the limit is still just declined", async () => {
    logAiCoachEscalation.mockClear();
    const out = await runCoachTurn({ ...base, message: "what is a healthy breakfast" });
    expect(out.reply).toBe("limit reached");
    expect(logAiCoachEscalation).not.toHaveBeenCalled();
  });
});
