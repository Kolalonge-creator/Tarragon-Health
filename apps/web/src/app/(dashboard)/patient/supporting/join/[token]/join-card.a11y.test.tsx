/** @jest-environment jsdom */
/**
 * The invite screen (S29, supporter join path 2026-11-03): shows who asked and exactly what is being shared, once and in the
 * supporter's own voice; accepts only on the button; and when the link does not work, says why in one kind sentence with the one
 * next step (wrong email or phone, expired, already in). Axe-clean.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { JoinCard } from "./join-card";

let preview: { isPending: boolean; data: unknown };
let accept: { data: unknown; isPending: boolean };
let decline: { data: unknown; isPending: boolean; isSuccess: boolean; isError: boolean };
let status: { isPending: boolean; data: unknown };
const statusEnabled = jest.fn();
const mutate = jest.fn();
const declineMutate = jest.fn();
const refetch = jest.fn();
jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
jest.mock("./actions", () => ({ signOutAndReturnToInvite: jest.fn() }));
jest.mock("@/lib/queries/care-circle", () => ({
  usePreviewInvite: () => ({ ...preview, refetch }),
  useAcceptInvite: () => ({ ...accept, mutate, reset: jest.fn() }),
  useDeclineInvite: () => ({ ...decline, mutate: declineMutate }),
  useInviteStatus: (_token: string, enabled: boolean) => {
    statusEnabled(enabled);
    return enabled ? status : { isPending: true, data: undefined };
  },
}));

const OK = { ok: true, inviter_first_name: "Ngozi", relationship: "Daughter", permissions: ["weekly_bp_trend", "pay_for_care"], grant_days: 365, expires_at: "2026-10-09T00:00:00Z" };
beforeEach(() => {
  preview = { isPending: false, data: OK };
  accept = { data: undefined, isPending: false };
  decline = { data: undefined, isPending: false, isSuccess: false, isError: false };
  status = { isPending: false, data: { reason: "not_available" } };
  statusEnabled.mockReset();
  mutate.mockReset();
  declineMutate.mockReset();
  refetch.mockReset();
});

describe("JoinCard", () => {
  it("names the inviter and says what will be shared once, in the supporter's own voice", async () => {
    render(<JoinCard token="tok" locale="en" />);
    expect(screen.getByRole("heading", { name: "Ngozi invited you to their Care Circle" })).toBeTruthy();
    expect(screen.getByText("They added you as: Daughter")).toBeTruthy();
    const list = screen.getByTestId("supporter-permission-list");
    expect(list.textContent).toMatch(/See Ngozi's weekly blood pressure trend, as averages only/);
    expect(list.textContent).toMatch(/Pay for Ngozi's care/);
    // no patient-voice line, and no second copy of the same list
    expect(document.body.textContent).not.toMatch(/My weekly blood pressure trend/);
    expect(screen.getAllByText(/weekly blood pressure trend/)).toHaveLength(1);
    // the BP trend, the weekly note, then pay and small jobs
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(statusEnabled).toHaveBeenLastCalledWith(false);
    cleanup();
    await expectNoA11yViolations(<JoinCard token="tok" locale="en" />);
  });

  it("accepts only when the person presses Accept, with the token from the link", async () => {
    render(<JoinCard token="tok" locale="en" />);
    expect(mutate).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Accept" })));
    expect(mutate).toHaveBeenCalledWith("tok");
  });

  it("an invite sent to another email names that email kindly and offers to switch account", async () => {
    preview = { isPending: false, data: { ok: false } };
    status = { isPending: false, data: { reason: "wrong_contact", contact_kind: "email", contact_hint: "n***@example.com" } };
    render(<JoinCard token="tok" locale="en" />);
    expect(screen.getByRole("alert").textContent).toMatch(/sent to n\*\*\*@example\.com, which is not the email address/);
    expect(screen.getByRole("button", { name: "Sign in with a different account" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    cleanup();
    await expectNoA11yViolations(<JoinCard token="tok" locale="en" />);
  });

  it("names a phone invite as a phone number", () => {
    preview = { isPending: false, data: { ok: false } };
    status = { isPending: false, data: { reason: "wrong_contact", contact_kind: "phone", contact_hint: "+234***45" } };
    render(<JoinCard token="tok" locale="en" />);
    expect(screen.getByRole("alert").textContent).toMatch(/not the phone number/);
  });

  it("an expired invite says so and what to do", () => {
    preview = { isPending: false, data: { ok: false } };
    status = { isPending: false, data: { reason: "expired" } };
    render(<JoinCard token="tok" locale="en" />);
    expect(screen.getByRole("alert").textContent).toMatch(/has expired/);
    expect(screen.queryByRole("button", { name: "Sign in with a different account" })).toBeNull();
  });

  it("someone already in the circle is told so and taken to that person's page", () => {
    preview = { isPending: false, data: { ok: false } };
    status = { isPending: false, data: { reason: "already_member", patient_id: "11111111-2222-4333-8444-555555555555" } };
    render(<JoinCard token="tok" locale="en" />);
    expect(screen.getByRole("alert").textContent).toMatch(/already in this Care Circle/);
    expect(screen.getByRole("link", { name: "Go to People you support" }).getAttribute("href")).toBe("/patient/supporting/circle/11111111-2222-4333-8444-555555555555");
  });

  it("a refused accept asks for the reason too", () => {
    accept = { data: { ok: false }, isPending: false };
    status = { isPending: false, data: { reason: "no_longer_valid" } };
    render(<JoinCard token="tok" locale="en" />);
    expect(statusEnabled).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("alert").textContent).toMatch(/no longer valid/);
  });

  it("a passing failure offers to try again", () => {
    preview = { isPending: false, data: { ok: false } };
    render(<JoinCard token="tok" locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("after joining, says so warmly and points to the person's page", () => {
    accept = { data: { ok: true, patient_id: "p-1", member_id: "m-1" }, isPending: false };
    render(<JoinCard token="tok" locale="en" />);
    expect(screen.getByRole("heading", { name: "You are in Ngozi's Care Circle" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Ngozi's page" }).getAttribute("href")).toBe("/patient/supporting/circle/p-1");
  });

  it("shows a quiet placeholder with no buttons while it checks", () => {
    preview = { isPending: true, data: undefined };
    render(<JoinCard token="tok" locale="en" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("status", { name: "Checking your invite" })).toBeTruthy();
  });

  it("S29e: a supporter in another organisation is offered exactly what the database sent, with no payment line", () => {
    preview = { isPending: false, data: { ...OK, permissions: ["weekly_bp_trend"], cross_organisation: true } };
    render(<JoinCard token="tok" locale="en" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText(/\bpay\b/i)).toBeNull();
    expect(screen.queryByText(/small jobs/)).toBeNull();
    expect(screen.getByText(/some options are not available to you/)).toBeTruthy();
  });

  it("S29e: offers the same link in the app through the app scheme, with the token encoded", () => {
    render(<JoinCard token="a/b c" locale="en" />);
    expect(screen.getByRole("link", { name: "Open in the Tarragon Health app" }).getAttribute("href")).toBe("tarragonhealth://join/a%2Fb%20c");
  });

  it("S69b: 'Not now' is a quiet button that tells the sender nothing, and the screen says only that nothing was shared", () => {
    render(<JoinCard token="tok" locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(declineMutate).toHaveBeenCalledWith("tok");
    cleanup();
    decline = { data: true, isPending: false, isSuccess: true, isError: false };
    render(<JoinCard token="tok" locale="en" />);
    expect(screen.getByRole("status").textContent).toMatch(/Nothing has been shared with you/);
    expect(document.body.textContent).not.toMatch(/declin/i);
  });

  it("S69b: a failed 'Not now' says so and keeps the invite on screen", () => {
    decline = { data: undefined, isPending: false, isSuccess: false, isError: true };
    render(<JoinCard token="tok" locale="en" />);
    expect(screen.getByRole("alert").textContent).toMatch(/could not do that/);
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
  });
});
