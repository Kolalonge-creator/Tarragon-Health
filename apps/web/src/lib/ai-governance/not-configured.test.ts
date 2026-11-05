import { describe, expect, it, jest } from "@jest/globals";

jest.mock("server-only", () => ({}));

const recordAiInteraction = jest.fn<(...args: unknown[]) => Promise<string | null>>(async () => "row-id");
jest.mock("./audit", () => ({ recordAiInteraction: (...args: unknown[]) => recordAiInteraction(...args) }));

import { recordAiCredentialMissing } from "./not-configured";

describe("recordAiCredentialMissing", () => {
  it("records a degraded fallback carrying an error_message, the shape the ai_call_failures alert counts", async () => {
    const supabase = {} as never;
    const id = await recordAiCredentialMissing(supabase, {
      systemCode: "AI-005",
      inputCategory: "lab_report_document",
      subjectProfileId: "patient-1",
      resultingEntityType: "lab_report_documents",
      resultingEntityId: "doc-1",
    });

    expect(id).toBe("row-id");
    expect(recordAiInteraction).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        systemCode: "AI-005",
        status: "fallback",
        modelIdentifier: "none:fallback",
        // the alert counts a fallback as a failure only when error_message is set; a kill-switch fallback has none
        errorMessage: "ANTHROPIC_API_KEY is not set",
        // ai_interaction_log_fallback_reason: a fallback must carry a reason
        fallbackReason: expect.stringContaining("ANTHROPIC_API_KEY"),
        subjectProfileId: "patient-1",
        resultingEntityId: "doc-1",
      })
    );
  });
});
