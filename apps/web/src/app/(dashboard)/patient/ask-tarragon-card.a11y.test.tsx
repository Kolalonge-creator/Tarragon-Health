/** @jest-environment jsdom */
/**
 * Accessibility regression coverage for AskTarragonCard -- the prominent
 * Overview "ask" entry point composing the already-tested AI Coach
 * (ai-coach-chat.a11y.test.tsx) and PatientResultUpload flows. This test
 * mocks PatientResultUpload out, same reasoning as ai-coach-chat's own test
 * mocking handoff-actions: it's a separately-owned, already-shipped
 * component reused as-is, not new surface this test exists to re-verify.
 *
 * Covers the empty state, a state with a generated reply (so the CTA row
 * and the "report this answer" affordance are both in the DOM axe scans),
 * and coachAccess=false (the symptom half must not render at all -- see
 * ask-tarragon-card.tsx's own doc comment on why).
 */
import { screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { AskTarragonCard } from "./ask-tarragon-card";

const invalidateQueries = jest.fn();
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

let conversation: { conversationId?: string; messages: unknown[] } | undefined;
let sendMessageData:
  | { success: true; conversationId: string; reply: string; tier: string; aiInteractionId: string | null }
  | { success: false; error: string }
  | undefined;
jest.mock("@/lib/queries/ai-coach", () => ({
  useAiConversation: () => ({ data: conversation }),
  useSendCoachMessage: () => ({ mutate: jest.fn(), isPending: false, data: sendMessageData }),
}));
jest.mock("@/lib/ai-coach/handoff-actions", () => ({
  requestCareTeamHandoffAction: jest.fn(async () => ({ success: true, threadId: "thread-1" })),
}));
jest.mock("@/components/patient-result-upload", () => ({
  PatientResultUpload: () => <div>Upload a result (stub)</div>,
}));

describe("AskTarragonCard accessibility", () => {
  beforeEach(() => {
    conversation = { conversationId: undefined, messages: [] };
    sendMessageData = undefined;
  });

  it("has no axe violations in the empty (no question asked yet) state", async () => {
    await expectNoA11yViolations(<AskTarragonCard patientId="patient-1" coachAccess />);
  });

  it("has no axe violations once a reply and its CTAs are shown", async () => {
    conversation = { conversationId: "conv-1", messages: [] };
    sendMessageData = {
      success: true,
      conversationId: "conv-1",
      reply: "A headache lasting two days is worth mentioning to your care team.",
      tier: "routine",
      aiInteractionId: "interaction-1",
    };
    const { container } = await expectNoA11yViolations(
      <AskTarragonCard patientId="patient-1" coachAccess />
    );
    // Sanity check the interesting state actually rendered, so a future
    // refactor that silently drops the reply/CTA row can't pass this test by
    // accident (an empty DOM has no violations either).
    expect(container.textContent).toContain("worth mentioning to your care team");
    expect(screen.getByRole("link", { name: /book a video visit/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /i want to speak to someone/i })).toBeTruthy();
  });

  it("hides the symptom widget entirely when coachAccess is false, uploads still shown", async () => {
    const { container } = await expectNoA11yViolations(
      <AskTarragonCard patientId="patient-1" coachAccess={false} />
    );
    expect(screen.queryByPlaceholderText(/headache/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^ask$/i })).toBeNull();
    expect(container.textContent).toContain("Upload a result (stub)");
  });
});
