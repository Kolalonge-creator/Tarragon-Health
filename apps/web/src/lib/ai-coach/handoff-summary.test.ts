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

    const summary = await buildCoachHandoffSummary(input(), mockModel);
    expect(summary).toContain("Patient concern: worried about dizziness");
    expect(summary).toContain("Symptoms: dizziness on standing");
    expect(summary).toContain(`AI action: ${input().aiAction}`);
  });

  it("falls back to a plain template, never throwing, when the model call fails", async () => {
    const failingModel = {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error("network error");
        },
      }),
    } as unknown as ChatAnthropic;

    const summary = await buildCoachHandoffSummary(
      input({ triggerMessage: "chest tightness", medications: ["Amlodipine"], conditions: ["Hypertension"] }),
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

    const summary = await buildCoachHandoffSummary(input(), failingModel);
    expect(summary).toContain("Medication: None on file");
    expect(summary).toContain("Relevant history: None on file");
  });
});
