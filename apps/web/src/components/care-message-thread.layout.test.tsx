/** @jest-environment jsdom */
/** Design audit P2 (Messages): avatars and chat alignment, with the attribution rules unchanged. */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let messages: unknown[] = [];
let actionRows: { id: string; message_id: string; kind: string }[] = [];
jest.mock("@/lib/queries/care-messages", () => ({
  useThreadMessages: () => ({ data: messages, isLoading: false }),
  usePostMessage: () => ({ mutate: jest.fn(), isPending: false }),
  useMessageActions: () => ({ data: actionRows }),
  useAddMessageActions: () => ({ mutate: jest.fn() }),
  useThreadStatus: () => ({ data: undefined }),
  useMarkThreadRead: () => ({ mutate: jest.fn() }),
  useCareMessageTemplates: () => ({ data: [] }),
  useUploadCareMessageAttachment: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("@/components/doctor-name-link", () => ({ DoctorNameLink: ({ fullName }: { fullName: string }) => <span>{fullName}</span> }));
jest.mock("@/components/licence-verified-client", () => ({ LicenceVerifiedForClient: () => null }));
jest.mock("@/components/draft-reply-card", () => ({ DraftReplyCard: () => null }));

import { CareMessageThread, receiptText } from "./care-message-thread";

const wrap = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

const base = { attachments: [], created_at: "2026-10-29T10:00:00Z" };

describe("CareMessageThread layout", () => {
  it("shows initials avatars, and never names a coordinator as a doctor", () => {
    messages = [
      { ...base, id: "1", body: "My BP is high", author_role: "patient", author_display: "Amaka Okafor", actor: null },
      { ...base, id: "2", body: "Thanks, reviewing", author_role: "care_team", author_display: null, actor: { id: "s1", full_name: "Tunde Bello", doctor_tier: "care_coordinator" } },
      { ...base, id: "3", body: "Please recheck", author_role: "care_team", author_display: null, actor: { id: "s2", full_name: "Ngozi Eze", doctor_tier: "senior_medical_officer" } },
    ];
    render(<CareMessageThread threadId="t1" patientId="p1" closed />, { wrapper: wrap });
    expect(screen.getByText("AO")).not.toBeNull(); // patient initials
    expect(screen.getByText("CT")).not.toBeNull(); // coordinator is the generic care team
    expect(screen.getByText("NE")).not.toBeNull(); // named doctor
    expect(screen.queryByText("Tunde Bello")).toBeNull();
    expect(screen.getByText("Ngozi Eze")).not.toBeNull();
  });

  it("puts the viewer's own messages on the right for a patient and on the left for staff", () => {
    messages = [{ ...base, id: "1", body: "Hello", author_role: "patient", author_display: "Amaka Okafor", actor: null }];
    const { container, rerender } = render(<CareMessageThread threadId="t1" patientId="p1" closed />, { wrapper: wrap });
    expect(container.querySelector("li")?.className).toContain("flex-row-reverse");
    rerender(<CareMessageThread threadId="t1" patientId="p1" closed isStaff />);
    expect(container.querySelector("li")?.className).not.toContain("flex-row-reverse");
  });

  it("says seen only when the other side opened the thread after the message was sent", () => {
    expect(receiptText("2026-10-30T10:00:00Z", null, true)).toBe("Sent, not seen yet");
    expect(receiptText("2026-10-30T10:00:00Z", "2026-10-30T09:59:00Z", true)).toBe("Sent, not seen yet");
    expect(receiptText("2026-10-30T10:00:00Z", "2026-10-30T10:05:00Z", true)).toMatch(/^Seen by the patient/);
    expect(receiptText("2026-10-30T10:00:00Z", "2026-10-30T10:05:00Z", false)).toMatch(/^Seen by your care team/);
  });

  it("shows a care-team action as a link to the patient and as a plain note to staff", () => {
    messages = [{ ...base, id: "1", body: "Please book", author_role: "care_team", author_display: null, actor: null, attachments: [] }];
    actionRows = [{ id: "a1", message_id: "1", kind: "book_appointment" }];
    const { rerender } = render(<CareMessageThread threadId="t1" patientId="p1" closed />, { wrapper: wrap });
    expect(screen.getByRole("link", { name: "Book an appointment" }).getAttribute("href")).toBe("/patient/appointments");
    rerender(<CareMessageThread threadId="t1" patientId="p1" closed isStaff />);
    expect(screen.queryByRole("link", { name: "Book an appointment" })).toBeNull();
    expect(screen.getByText("Button: Book an appointment")).toBeTruthy();
    actionRows = [];
  });
});
