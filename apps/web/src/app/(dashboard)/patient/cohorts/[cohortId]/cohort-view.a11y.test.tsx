/** @jest-environment jsdom */
/**
 * The cohort screen (S69): shows the group's own total and goal, never an individual figure; the member list is first names only; a
 * restricted person gets the neutral line; no WhatsApp button; moderator tools only for a moderator; axe-clean.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { findShameCopy } from "@tarragon/shared";
import { CohortView } from "./cohort-view";

const COHORT = { cohort_id: "c1", name: "Grace Fellowship Group", kind: "church", state: "active", is_moderator: false, muted: false, contributing: true };
const mockChallenges = [
  { challenge_id: "ch1", label: "Move together", unit: "minutes", starts_on: "2026-10-07", ends_on: "2026-10-20", phase: "active", available: true, contributing: true,
    total: { state: "shown", total: 1810, progress_pct: 100, goal_reached: true, group_size: "10-19", as_of: "2026-10-08", final: false } },
  { challenge_id: "ch2", label: "Lower-salt days", unit: "days", starts_on: "2026-10-07", ends_on: "2026-10-20", phase: "active", available: false, contributing: true,
    total: { state: "hidden" } },
];
let mockMine: { isPending: boolean; data: unknown };
function mockNoop() {
  return { mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false, data: undefined, error: null };
}
jest.mock("@/lib/queries/cohorts", () => {
  const actual = jest.requireActual("@/lib/queries/cohorts");
  return {
    ...actual,
    useMyCohorts: () => mockMine,
    useCohortChallenges: () => ({ isPending: false, data: jest.requireActual("@/lib/cohorts/model").parseChallenges(mockChallenges.map((c) => ({ ...c, yours: 163 }))) }),
    useRoster: () => ({ data: [{ member_id: "m1", first_name: "Ada", role: "moderator", is_you: false }, { member_id: "m2", first_name: "Chidi", role: "member", is_you: true }] }),
    useChallengeSummary: () => ({ data: { available: true, contributing: true, did_today: false, skipped_this_week: false, rest_available: true, weeks_active: 3 } }),
    useEffortHistory: () => ({ data: { weeks_active: 3, challenges: [{ label: "Move together", unit: "minutes", starts_on: "2026-09-01", ends_on: "2026-09-14", phase: "ended", days_with_effort: 6, total_effort: 140, rest_days: 1 }] } }),
    useRestCheckin: mockNoop, useSkipWeek: mockNoop,
    useModeratorReports: () => ({ data: [] }),
    useTemplates: () => ({ data: [] }),
    useCreateInvite: mockNoop, useStartChallenge: mockNoop, useCloseCohort: mockNoop, useRemoveMember: mockNoop, useContribute: mockNoop, useTotalsConsent: mockNoop,
    useMute: mockNoop, useLeave: mockNoop, useReport: mockNoop,
  };
});

beforeEach(() => {
  mockMine = { isPending: false, data: { open: true, off: false, cohorts: [COHORT] } };
});

describe("CohortView", () => {
  it("shows the group total and goal, and never an individual value", async () => {
    const { container } = render(<CohortView cohortId="c1" locale="en" />);
    expect(screen.getByText(/Group total so far: 1810 minutes/)).toBeTruthy();
    expect(screen.getByText("The group reached its goal.")).toBeTruthy();
    expect(container.textContent).not.toContain("163");
    expect(container.textContent).not.toMatch(/rank \d|your rank/i);
    cleanup();
    await expectNoA11yViolations(<CohortView cohortId="c1" locale="en" />);
  });

  it("shows first names only in the member list", () => {
    render(<CohortView cohortId="c1" locale="en" />);
    expect(screen.getByText(/Ada/)).toBeTruthy();
    expect(screen.getByText(/Chidi \(you\)/)).toBeTruthy();
  });

  it("gives the neutral line for a challenge that is not available, with no reason", () => {
    const { container } = render(<CohortView cohortId="c1" locale="en" />);
    expect(screen.getByText("This challenge is not available for you.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/insulin|pregnan|kidney|eating|condition/i);
  });

  it("draws a shared goal path in shape and words, from the group total only", () => {
    const { container } = render(<CohortView cohortId="c1" locale="en" />);
    expect(screen.getAllByText(/Step 1 of 5: reached/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Together the group reached its shared goal/).length).toBeGreaterThan(0);
    expect(container.querySelectorAll("svg[aria-hidden='true']").length).toBeGreaterThan(0);
  });

  it("draws an empty path with a waiting line when the total is hidden", () => {
    render(<CohortView cohortId="c1" locale="en" />);
    expect(screen.getAllByText(/Step 1 of 5: the next step/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("The shared goal path appears once enough people have taken part.").length).toBeGreaterThan(0);
  });

  it("shows weeks active, a rest check-in and a no-penalty skip, with no shame wording and no comparison between groups", () => {
    const { container } = render(<CohortView cohortId="c1" locale="en" />);
    expect(screen.getAllByText("Weeks you have taken part: 3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Rest and check in").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Skip this week").length).toBeGreaterThan(0);
    expect(findShameCopy(container.textContent ?? "")).toEqual([]);
    expect(container.textContent).not.toMatch(/How groups compare|Group 2|Group 3/);
  });

  it("keeps the member's own effort history in their own view", () => {
    render(<CohortView cohortId="c1" locale="en" />);
    expect(screen.getByText("Your effort history")).toBeTruthy();
    expect(screen.getByText("Move together: 6 days taking part, 1 of them rest check-ins")).toBeTruthy();
  });

  it("offers no moderator tools to a plain member, and no WhatsApp anywhere", () => {
    const { container } = render(<CohortView cohortId="c1" locale="en" />);
    expect(screen.queryByText("Moderator tools")).toBeNull();
    expect(container.innerHTML).not.toMatch(/whatsapp|wa\.me/i);
  });

  it("shows the moderator tools to a moderator, who is told they see no health information", () => {
    mockMine = { isPending: false, data: { open: true, off: false, cohorts: [{ ...COHORT, is_moderator: true }] } };
    render(<CohortView cohortId="c1" locale="en" />);
    expect(screen.getByText("Moderator tools")).toBeTruthy();
    expect(screen.getByText(/never see anyone's health information/)).toBeTruthy();
    expect(screen.getByText(/Challenges appear once the Chief Medical Officer has approved them/)).toBeTruthy();
  });

  it("says the group is not open when community is closed", () => {
    mockMine = { isPending: false, data: { open: false, off: false, cohorts: [] } };
    render(<CohortView cohortId="c1" locale="en" />);
    expect(screen.getByText("Community groups are not open yet.")).toBeTruthy();
  });
});
