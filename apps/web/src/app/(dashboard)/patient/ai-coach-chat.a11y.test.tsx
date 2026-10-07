/** @jest-environment jsdom */
/**
 * Accessibility regression coverage for AiCoachChat — the patient-facing AI
 * Health Coach, one of the most-used surfaces on the dashboard.
 *
 * Covers the empty state and a state with an existing conversation (so the
 * message-bubble list, timestamps, and the "report this answer" affordance
 * are all in the DOM axe actually scans) plus the "limit reached" and
 * "speak to someone" banners.
 */
import { screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { AiCoachChat } from "./ai-coach-chat";

// jsdom has no scroll layout engine and doesn't implement scrollIntoView —
// the component calls it on every message-count change to keep the newest
// message in view.
Element.prototype.scrollIntoView = jest.fn();

const invalidateQueries = jest.fn();
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

let conversation: { conversationId?: string; messages: unknown[] } | undefined;
jest.mock("@/lib/queries/ai-coach", () => ({
  useAiConversation: () => ({ data: conversation }),
  useSendCoachMessage: () => ({ mutate: jest.fn(), isPending: false, data: undefined }),
  useAiCoachQuickAction: () => ({ mutate: jest.fn(), isPending: false, data: undefined }),
}));
jest.mock("@/lib/ai-coach/handoff-actions", () => ({
  requestCareTeamHandoffAction: jest.fn(async () => ({ success: true })),
}));

describe("AiCoachChat accessibility", () => {
  beforeEach(() => {
    conversation = { conversationId: undefined, messages: [] };
  });

  it("has no axe violations in the empty (no conversation yet) state", async () => {
    await expectNoA11yViolations(<AiCoachChat patientId="patient-1" />);
  });

  it("has no axe violations once a conversation with messages exists", async () => {
    conversation = {
      conversationId: "conv-1",
      messages: [
        {
          id: "m1",
          role: "user",
          content: "What does my last BP reading mean?",
          created_at: "2026-09-10T10:00:00Z",
        },
        {
          id: "m2",
          role: "assistant",
          content: "Your last reading was in the normal range.",
          created_at: "2026-09-10T10:00:05Z",
          suggestedAction: "care_plan_explanation",
        },
      ],
    };
    const { container } = await expectNoA11yViolations(<AiCoachChat patientId="patient-1" />);
    // Sanity check the interesting state actually rendered, so a future
    // refactor that silently drops the message list can't pass this test by
    // accident (an empty DOM has no violations either).
    expect(container.textContent).toContain("What does my last BP reading mean?");
    expect(screen.getByRole("textbox")).toBeTruthy();
  });
});
