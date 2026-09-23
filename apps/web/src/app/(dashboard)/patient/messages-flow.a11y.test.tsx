/** @jest-environment jsdom */
/**
 * Accessibility regression coverage for MessagesFlow — the patient-facing
 * "Message your care team" surface. Covers the thread list (empty and with
 * threads), the new-message compose form, and an open conversation (which
 * mounts the shared CareMessageThread component too).
 */
import { fireEvent, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { expectNoA11yViolations } from "@/test/a11y";
import { MessagesFlow } from "./messages-flow";

let threads: unknown[] | undefined;
jest.mock("@/lib/queries/care-messages", () => ({
  useCareThreads: () => ({ data: threads, isLoading: false }),
  useStartThread: () => ({ mutate: jest.fn(), isPending: false }),
  useThreadMessages: () => ({ data: [], isLoading: false }),
  usePostMessage: () => ({ mutate: jest.fn(), isPending: false }),
  useMarkThreadRead: () => ({ mutate: jest.fn() }),
  useUploadCareMessageAttachment: () => ({ mutate: jest.fn(), isPending: false }),
  useCareMessageTemplates: () => ({ data: [] }),
}));

const THREAD = {
  id: "thread-1",
  subject: "Question about my dosage",
  category: "medication" as const,
  status: "open" as const,
  last_message_at: "2026-09-10T10:00:00Z",
};

describe("MessagesFlow accessibility", () => {
  beforeEach(() => {
    threads = [];
  });

  it("has no axe violations with no conversations yet", async () => {
    await expectNoA11yViolations(<MessagesFlow patientId="patient-1" />);
  });

  it("has no axe violations with a thread list and the compose form open", async () => {
    threads = [THREAD];
    const { container } = await expectNoA11yViolations(<MessagesFlow patientId="patient-1" />);
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    // Re-scan the SAME container the click happened in, so the compose
    // form actually mounted here (Subject input, category select, its
    // aria-describedby hint) is what axe evaluates — not a fresh,
    // still-closed instance.
    expect(await screen.findByLabelText("Subject")).toBeTruthy();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations with a conversation open", async () => {
    threads = [THREAD];
    const { container } = await expectNoA11yViolations(<MessagesFlow patientId="patient-1" />);
    fireEvent.click(screen.getByText("Question about my dosage"));
    expect(await axe(container)).toHaveNoViolations();
  });
});
