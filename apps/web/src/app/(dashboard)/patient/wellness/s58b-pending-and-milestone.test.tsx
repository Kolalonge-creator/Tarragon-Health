/** @jest-environment jsdom */
/**
 * S58b: the pending-credit list (with a calm route to ask) and the one milestone card.
 * The card celebrates a care step, can be dismissed, and is simply absent when the database returns nothing (which it does while an emergency is open).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { en } from "@tarragon/i18n";
import { expectNoA11yViolations } from "@/test/a11y";
import { MilestoneCard } from "./milestone-card";
import { PendingCredit } from "./pending-credit";

let pending: unknown[] | undefined;
let milestone: { id: string; code: string; achieved_at: string } | null | undefined;
const mutate = jest.fn();
jest.mock("@/lib/queries/wellness", () => ({
  useMyPointsPending: () => ({ data: pending }),
  useMyPendingMilestone: () => ({ data: milestone }),
  useDismissMilestone: () => ({ mutate, isPending: false }),
}));

afterEach(() => {
  cleanup();
  mutate.mockReset();
});

const future = new Date(Date.now() + 10 * 60_000).toISOString();
const past = new Date(Date.now() - 60 * 60_000).toISOString();
const base = { event_id: "e1", rule_codes: ["meal_logged"], since: past, expected_by: future, ask_support: false };

describe("PendingCredit", () => {
  it("renders nothing when nothing is pending", () => {
    pending = [];
    const { container } = render(<PendingCredit patientId="p" />);
    expect(container.innerHTML).toBe("");
  });

  it("lists the action, says when it is expected, and offers no support link yet", () => {
    pending = [base];
    render(<PendingCredit patientId="p" />);
    expect(screen.getByText("Log a meal")).toBeTruthy();
    expect(screen.getByText(/Usually added by \d{2}:\d{2}\./)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("after the ask window, shows a calm link to the support page with the points topic", async () => {
    pending = [{ ...base, expected_by: past, ask_support: true }];
    render(<PendingCredit patientId="p" />);
    expect(screen.getByText(en["points.pending.later"])).toBeTruthy();
    const link = screen.getByRole("link", { name: en["points.pending.ask_link"] });
    expect(link.getAttribute("href")).toBe("/patient/support?topic=points");
    cleanup();
    await expectNoA11yViolations(<PendingCredit patientId="p" />);
  });

  it("uses no word that frames a loss", () => {
    const text = ["points.pending.title", "points.pending.intro", "points.pending.expected", "points.pending.later", "points.pending.ask", "points.pending.ask_link"]
      .map((k) => en[k as keyof typeof en])
      .join(" ");
    expect(text).not.toMatch(/\b(lose|lost|missing|missed|expire|expired|behind|late|overdue|deadline|failed)\b/i);
  });
});

describe("MilestoneCard", () => {
  it("renders nothing when there is no card (including while an emergency is open)", () => {
    milestone = null;
    const { container } = render(<MilestoneCard patientId="p" />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the step that was done and dismisses once on request", async () => {
    milestone = { id: "m1", code: "first_lab_done", achieved_at: new Date().toISOString() };
    render(<MilestoneCard patientId="p" />);
    expect(screen.getByText(en["points.milestone.first_lab_done.title"])).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: en["points.milestone.dismiss"] }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith("m1");
    cleanup();
    await expectNoA11yViolations(<MilestoneCard patientId="p" />);
  });

  it("an unknown new milestone code reads as a plain thank-you, never a raw key", () => {
    milestone = { id: "m2", code: "some_new_code", achieved_at: new Date().toISOString() };
    render(<MilestoneCard patientId="p" />);
    expect(screen.getByText(en["points.milestone.generic.title"])).toBeTruthy();
  });

  it("shows no number, rank, streak or comparison", () => {
    milestone = { id: "m3", code: "adherence_4_weeks", achieved_at: new Date().toISOString() };
    const { container } = render(<MilestoneCard patientId="p" />);
    expect(container.textContent).not.toMatch(/\b(rank|leaderboard|streak|beat|top|%|points)\b/i);
  });
});
