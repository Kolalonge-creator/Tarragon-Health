/** @jest-environment jsdom */
/**
 * The invite screen (S29): shows who asked and exactly what is being shared, accepts only on the button, and shows ONE message for
 * every failure so a stranger learns nothing about who was invited. Axe-clean.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { JoinCard } from "./join-card";

let preview: { isPending: boolean; data: unknown };
let accept: { data: unknown; isPending: boolean };
let decline: { data: unknown; isPending: boolean; isSuccess: boolean; isError: boolean };
const mutate = jest.fn();
const declineMutate = jest.fn();
jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
jest.mock("@/lib/queries/care-circle", () => ({
  usePreviewInvite: () => preview,
  useAcceptInvite: () => ({ ...accept, mutate }),
  useDeclineInvite: () => ({ ...decline, mutate: declineMutate }),
}));

const OK = { ok: true, inviter_first_name: "Ngozi", relationship: "Daughter", permissions: ["weekly_bp_trend", "pay_for_care"], grant_days: 365, expires_at: "2026-10-09T00:00:00Z" };
beforeEach(() => {
  preview = { isPending: false, data: OK };
  accept = { data: undefined, isPending: false };
  decline = { data: undefined, isPending: false, isSuccess: false, isError: false };
  mutate.mockReset();
  declineMutate.mockReset();
});

describe("JoinCard", () => {
  it("names the inviter and lists exactly what will be shared", async () => {
    render(<JoinCard token="tok" locale="en" />);
    expect(screen.getByText(/Ngozi asked you to join their Care Circle as Daughter/)).toBeTruthy();
    // the original list of what is shared: exactly the two permissions the invite carries
    expect(document.querySelectorAll("#join-sees ~ ul li")).toHaveLength(2);
    expect(screen.getByText(/never single readings/)).toBeTruthy();
    cleanup();
    await expectNoA11yViolations(<JoinCard token="tok" locale="en" />);
  });

  it("accepts only when the person presses Accept, with the token from the link", async () => {
    render(<JoinCard token="tok" locale="en" />);
    expect(mutate).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Accept" })));
    expect(mutate).toHaveBeenCalledWith("tok");
  });

  it("shows one message for an invalid, expired, used or wrong-account link", () => {
    preview = { isPending: false, data: { ok: false } };
    render(<JoinCard token="tok" locale="en" />);
    expect(screen.getByRole("alert").textContent).toMatch(/does not work/);
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });

  it("shows one message when accepting is refused too", () => {
    accept = { data: { ok: false }, isPending: false };
    render(<JoinCard token="tok" locale="en" />);
    expect(screen.getByRole("alert").textContent).toMatch(/does not work/);
  });

  it("after joining, points to the person's page", () => {
    accept = { data: { ok: true, patient_id: "p-1", member_id: "m-1" }, isPending: false };
    render(<JoinCard token="tok" locale="en" />);
    expect(screen.getByRole("status").textContent).toMatch(/You have joined/);
    expect(screen.getByRole("link", { name: "See your people" }).getAttribute("href")).toBe("/patient/supporting/circle/p-1");
  });

  it("shows nothing but a placeholder while it checks", () => {
    preview = { isPending: true, data: undefined };
    render(<JoinCard token="tok" locale="en" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("S29e: a supporter in another organisation is offered exactly what the database sent, with no payment line", () => {
    preview = { isPending: false, data: { ...OK, permissions: ["weekly_bp_trend"], cross_organisation: true } };
    render(<JoinCard token="tok" locale="en" />);
    expect(document.querySelectorAll("#join-sees ~ ul li")).toHaveLength(1);
    expect(screen.queryByText(/Paying for my care/)).toBeNull();
    // and the plain-language preview says the same: no payment, no shared jobs
    expect(screen.queryByText(/Pay for care/)).toBeNull();
    expect(screen.queryByText(/small shared jobs/)).toBeNull();
  });

  it("S29e: offers the same link in the app through the app scheme, with the token encoded", () => {
    render(<JoinCard token="a/b c" locale="en" />);
    expect(screen.getByRole("link", { name: "Open in the Tarragon Health app" }).getAttribute("href")).toBe("tarragonhealth://join/a%2Fb%20c");
  });

  it("S69b: shows a plain-language preview of exactly what will be shared, before Accept", async () => {
    render(<JoinCard token="tok" locale="en" />);
    const summary = screen.getByTestId("permission-summary");
    expect(summary.textContent).toMatch(/You will see/);
    expect(summary.textContent).toMatch(/weekly blood pressure trend, as averages only/);
    expect(summary.textContent).toMatch(/Pay for care/);
    expect(summary.textContent).toMatch(/Never shared: single readings/);
    expect(summary.textContent).toMatch(/Ngozi can stop sharing at any time/);
    // it promises nothing the invite does not carry
    expect(summary.textContent).not.toMatch(/Whether medicines were taken/);
    cleanup();
    await expectNoA11yViolations(<JoinCard token="tok" locale="en" />);
  });

  it("S69b: 'Not now' is a quiet button that tells the sender nothing, and the screen says only that nothing was shared", () => {
    render(<JoinCard token="tok" locale="en" />);
    expect(mutate).not.toHaveBeenCalled();
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
