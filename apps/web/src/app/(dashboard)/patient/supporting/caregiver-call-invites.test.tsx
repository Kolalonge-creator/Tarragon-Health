/** @jest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { CaregiverCallInvites } from "./caregiver-call-invites";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

let invites: { data: unknown[] };
const answer = jest.fn();
jest.mock("@/lib/queries/caregiver-invites", () => ({
  useMyConsultationInvites: () => invites,
  useAnswerConsultationInvite: () => ({ mutateAsync: answer, isPending: false }),
}));

const BASE = {
  pass_id: "pass-1",
  encounter_id: "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44",
  patient_id: "p1",
  patient_first_name: "Mama",
  relationship: "Daughter",
  state: "invited",
  scheduled_at: "2026-10-16T09:00:00Z",
  expires_at: "2026-10-16T13:00:00Z",
  join_opens_at: "2026-10-16T08:45:00Z",
  join_closes_at: "2026-10-16T10:00:00Z",
  joinable: false,
  final_media_mode: null,
};

beforeEach(() => {
  invites = { data: [BASE] };
  answer.mockReset();
});

describe("CaregiverCallInvites", () => {
  it("shows 'invited to join' with a first name and a time, and lets the person accept or decline", async () => {
    answer.mockResolvedValue(undefined);
    render(<CaregiverCallInvites locale="en" />);
    expect(screen.getByText(/Invited to join a call with Mama on/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Accept the invite" })));
    expect(answer).toHaveBeenCalledWith({ passId: "pass-1", accept: true });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "No thanks" })));
    expect(answer).toHaveBeenLastCalledWith({ passId: "pass-1", accept: false });
  });

  it("shows a Join button that goes to the caregiver's room once accepted", () => {
    invites = { data: [{ ...BASE, state: "accepted" }] };
    render(<CaregiverCallInvites locale="en" />);
    expect(screen.getByRole("link", { name: "Join the call" }).getAttribute("href")).toBe("/patient/supporting/consultation/7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44");
    expect(screen.queryByRole("button", { name: "Accept the invite" })).toBeNull();
  });

  it("says so when an answer could not be saved", async () => {
    answer.mockRejectedValue(new Error("x"));
    render(<CaregiverCallInvites locale="en" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Accept the invite" })));
    expect(screen.getByRole("alert").textContent).toBe("We could not do that just now. Please try again.");
  });

  it("renders nothing when there is no live invite", () => {
    invites = { data: [] };
    const { container } = render(<CaregiverCallInvites locale="en" />);
    expect(container.textContent).toBe("");
  });

  it("has no accessibility violations", async () => {
    cleanup();
    await expectNoA11yViolations(<CaregiverCallInvites locale="en" />);
  });
});
