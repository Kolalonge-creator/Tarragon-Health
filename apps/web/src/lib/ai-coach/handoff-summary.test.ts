import { describe, expect, it } from "@jest/globals";
import type { ChatAnthropic } from "@langchain/anthropic";
import { buildCoachHandoffSummary, formatHandoffSummary, type HandoffSummaryInput } from "./handoff-summary";

function input(overrides: Partial<HandoffSummaryInput> = {}): HandoffSummaryInput {
  return {
    recentMessages: [],
    triggerMessage: "I've had a headache for two days",
    aiAction: "Flagged for clinician review after classifying the message",
    medications: [],
    conditions: [],
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

  it("skips the model call entirely and uses the template when there's no conversation to summarize", async () => {
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
