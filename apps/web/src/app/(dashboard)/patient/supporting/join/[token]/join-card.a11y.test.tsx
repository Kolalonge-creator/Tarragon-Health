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
const mutate = jest.fn();
jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
jest.mock("@/lib/queries/care-circle", () => ({
  usePreviewInvite: () => preview,
  useAcceptInvite: () => ({ ...accept, mutate }),
}));

const OK = { ok: true, inviter_first_name: "Ngozi", relationship: "Daughter", permissions: ["weekly_bp_trend", "pay_for_care"], grant_days: 365, expires_at: "2026-10-09T00:00:00Z" };
beforeEach(() => {
  preview = { isPending: false, data: OK };
  accept = { data: undefined, isPending: false };
  mutate.mockReset();
});

describe("JoinCard", () => {
  it("names the inviter and lists exactly what will be shared", async () => {
    render(<JoinCard token="tok" locale="en" />);
    expect(screen.getByText(/Ngozi asked you to join their Care Circle as Daughter/)).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
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
});
