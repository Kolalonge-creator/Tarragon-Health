import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ChatAnthropic } from "@langchain/anthropic";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { buildCoachHandoffSummary, formatHandoffSummary, type HandoffSummaryInput } from "./handoff-summary";
import { __clearAiGovernanceCache } from "@/lib/ai-governance";

/**
 * The handoff summary is part of AI-001, so AI-001's kill switch has to reach
 * it. Until 2026-09-16 it did not: this function took no Supabase client at
 * all and called ChatAnthropic directly, so switching the coach off stopped
 * the visible half and left this half calling the model.
 */
function fakeSupabase(enabled = true): SupabaseClient<Database> {
  return {
    rpc: jest.fn(async (fn: string) => {
      if (fn !== "ai_runtime_config") return { data: null, error: null };
      return {
        data: {
          registered: true,
          system_code: "AI-001",
          system_id: "00000000-0000-0000-0000-000000000001",
          name: "AI Health Coach",
          enabled,
          runtime_governed: true,
          lifecycle_status: "live",
          risk_class: "high",
          autonomy_level: "assist",
          clinically_meaningful: true,
          fallback_behaviour: "The deterministic keyword guardrail still runs.",
          disabled_reason: enabled ? null : "Paused by the Clinical Director.",
          expected_model_identifier: "claude-sonnet-5",
          prompt: null,
          guardrails: [],
          knowledge_sources: [],
        },
        error: null,
      };
    }),
  } as unknown as SupabaseClient<Database>;
}

function input(overrides: Partial<HandoffSummaryInput> = {}): HandoffSummaryInput {
  return {
    recentMessages: [],
    triggerMessage: "I've had a headache for two days",
    aiAction: "Flagged for clinician review after classifying the message",
    medications: [],
    conditions: [],
    supabase: fakeSupabase(),
    ...overrides,
  };
}

describe("formatHandoffSummary", () => {
  it("labels all five fields in the spec's order", () => {
    const text = formatHandoffSummary(
      { concern: "headache", symptoms: "throbbing pain", medication: "Amlodipine", relevantHistory: "Hypertension" },
      "Escalated to nurse"
    );
    expect(text).toBe(
      "Patient concern: headache\nSymptoms: throbbing pain\nMedication: Amlodipine\nRelevant history: Hypertension\nAI action: Escalated to nurse"
    );
  });
});

describe("buildCoachHandoffSummary", () => {
  beforeEach(() => __clearAiGovernanceCache());

  it("never reaches the model when AI-001 is switched off, and still returns a full summary", async () => {
    // 40.17. The escalation this summary is attached to must never be blocked
    // by the coach being off, so the templated fallback still fills every
    // field — it needs no AI at all.
    //
    // This asserts `invoke` was NOT CALLED rather than only checking the text.
    // The first version of this test used a model that throws and checked the
    // output, and it passed even with the governance check deleted — a thrown
    // call is caught and falls back to the same template, so the output is
    // byte-identical whether the kill switch worked or the model simply
    // failed. Only the call count tells those two apart.
    const invoke = jest.fn(async () => {
      throw new Error("the model must not be reached when AI-001 is off");
    });
    const modelThatMustNotBeCalled = {
      withStructuredOutput: () => ({ invoke }),
    } as unknown as ChatAnthropic;

    const summary = await buildCoachHandoffSummary(
      input({
        supabase: fakeSupabase(false),
        recentMessages: [
          { id: "1", role: "user", content: "chest tightness", created_at: "2026-08-30T00:00:00.000Z" },
        ],
        triggerMessage: "chest tightness",
        medications: ["Amlodipine"],
        conditions: ["Hypertension"],
      }),
      modelThatMustNotBeCalled,
    );

    expect(invoke).not.toHaveBeenCalled();
    expect(summary).toContain("Patient concern: chest tightness");
    expect(summary).toContain("Medication: Amlodipine");
    expect(summary).toContain("Relevant history: Hypertension");
  });

  it("does reach the model when AI-001 is on", async () => {
    // The control: without it, a function that always fell back would pass
    // the kill-switch test perfectly.
    const invoke = jest.fn(async () => ({
      concern: "chest tightness",
      symptoms: "tightness on exertion",
      medication: "Amlodipine",
      relevantHistory: "Hypertension",
    }));
    const model = { withStructuredOutput: () => ({ invoke }) } as unknown as ChatAnthropic;

    await buildCoachHandoffSummary(
      input({
        supabase: fakeSupabase(true),
        recentMessages: [
          { id: "1", role: "user", content: "chest tightness", created_at: "2026-08-30T00:00:00.000Z" },
        ],
      }),
      model,
    );

    expect(invoke).toHaveBeenCalled();
  });

  it("uses the structured model's output when the call succeeds", async () => {
    const mockModel = {
      withStructuredOutput: () => ({
        invoke: async () => ({
          concern: "worried about dizziness",
          symptoms: "dizziness on standing",
          medication: "None on file",
          relevantHistory: "None on file",
        }),
      }),
    } as unknown as ChatAnthropic;

    const summary = await buildCoachHandoffSummary(
      input({
        recentMessages: [
          { id: "1", role: "user", content: "I feel dizzy when I stand up", created_at: "2026-08-30T00:00:00.000Z" },
        ],
      }),
      mockModel
    );
    expect(summary).toContain("Patient concern: worried about dizziness");
    expect(summary).toContain("Symptoms: dizziness on standing");
    expect(summary).toContain(`AI action: ${input().aiAction}`);
  });

  it("skips the model call entirely and uses the template when there's no conversation to summarise", async () => {
    // A patient who clicks "speak to someone" without ever chatting with
    // the coach first -- recentMessages is empty. Passing a model that
    // throws proves the call was never made (a fallback triggered by a
    // caught error would look identical from the output alone).
    const modelThatMustNotBeCalled = {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error("should never be called with an empty conversation");
        },
      }),
    } as unknown as ChatAnthropic;

    const summary = await buildCoachHandoffSummary(
      input({ triggerMessage: "Patient asked to speak with someone directly, without a specific message." }),
      modelThatMustNotBeCalled
    );
    expect(summary).toContain("Patient concern: Patient asked to speak with someone directly");
    expect(summary).not.toContain("<UNKNOWN>");
  });

  it("falls back to a plain template, never throwing, when the model call fails", async () => {
    const failingModel = {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error("network error");
        },
      }),
    } as unknown as ChatAnthropic;

    const someConversation = [
      { id: "1", role: "user" as const, content: "chest tightness", created_at: "2026-08-30T00:00:00.000Z" },
    ];
    const summary = await buildCoachHandoffSummary(
      input({
        recentMessages: someConversation,
        triggerMessage: "chest tightness",
        medications: ["Amlodipine"],
        conditions: ["Hypertension"],
      }),
      failingModel
    );
    expect(summary).toContain("Patient concern: chest tightness");
    expect(summary).toContain("Medication: Amlodipine");
    expect(summary).toContain("Relevant history: Hypertension");
  });

  it("says 'None on file' rather than inventing medications/history when the fallback has none", async () => {
    const failingModel = {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error("network error");
        },
      }),
    } as unknown as ChatAnthropic;
    const someConversation = [
      { id: "1", role: "user" as const, content: "hi", created_at: "2026-08-30T00:00:00.000Z" },
    ];

    const summary = await buildCoachHandoffSummary(input({ recentMessages: someConversation }), failingModel);
    expect(summary).toContain("Medication: None on file");
    expect(summary).toContain("Relevant history: None on file");
  });
});
