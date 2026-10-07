/** @jest-environment jsdom */
/**
 * The cohort screen (S69): shows the group's own total and goal, never an individual figure; the member list is first names only; a
 * restricted person gets the neutral line; no WhatsApp button; moderator tools only for a moderator; axe-clean.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
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
jest.mock("@/lib/queries/community", () => {
  const actual = jest.requireActual("@/lib/queries/community");
  return {
    ...actual,
    useMyCohorts: () => mockMine,
    useCohortChallenges: () => ({ isPending: false, data: jest.requireActual("@/lib/community/model").parseChallenges(mockChallenges.map((c) => ({ ...c, yours: 163 }))) }),
    useRoster: () => ({ data: [{ member_id: "m1", first_name: "Ada", role: "moderator", is_you: false }, { member_id: "m2", first_name: "Chidi", role: "member", is_you: true }] }),
    useBoard: () => ({ isPending: false, data: { state: "shown", rows: [{ label: "Your group", rank: 1, progress_pct: 100, is_yours: true }, { label: "Group 2", rank: 2, progress_pct: 50, is_yours: false }, { label: "Group 3", rank: 3, progress_pct: 20, is_yours: false }] } }),
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

  it("compares groups with anonymous labels", () => {
    render(<CohortView cohortId="c1" locale="en" />);
    expect(screen.getAllByText("Your group: 100 percent of goal").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Group 2: 50 percent of goal").length).toBeGreaterThan(0);
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
