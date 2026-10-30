/** @jest-environment jsdom */
/**
 * Code review of the P4 trackers: the hero showed "0 drinks this week" when the read had FAILED, because a failed query leaves no data and
 * the weekly total of no data is 0. A failed read must never look like "none" (health-record rule), so the hero shows a load message instead.
 */
import { render, screen } from "@testing-library/react";
import { AlcoholClient } from "./alcohol-client";

const logsState = { isLoading: false, isError: false, data: undefined as undefined | { logged_on: string; drinks_count: number }[] };

jest.mock("@/lib/queries/alcohol", () => ({
  useAlcoholGoal: () => ({ isLoading: false, data: { target_drinks_per_week: 7 } }),
  useAlcoholConsumptionLogs: () => logsState,
  drinksThisWeek: (logs: { drinks_count: number }[]) => logs.reduce((s, l) => s + l.drinks_count, 0),
}));
jest.mock("./actions", () => ({ setAlcoholGoalAction: jest.fn(), logAlcoholConsumptionAction: jest.fn() }));
jest.mock("@/components/ui-language-provider", () => ({ useT: () => (s: string) => s }));
jest.mock("@/components/lifestyle-barrier-picker", () => ({ LifestyleBarrierPicker: () => null }));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));

describe("Alcohol hero on a failed read", () => {
  it("does not show a zero or the goal progress when the logs failed to load", () => {
    logsState.isError = true;
    logsState.data = undefined;
    render(<AlcoholClient patientId="p1" />);
    expect(screen.getByText(/couldn't load this just now/i)).toBeTruthy();
    expect(screen.queryByText(/drinks this week/)).toBeNull();
    expect(screen.queryByText(/of a 7 drinks\/week goal/)).toBeNull();
  });
  it("still shows the real total when the read worked", () => {
    logsState.isError = false;
    logsState.data = [{ logged_on: new Date().toISOString().slice(0, 10), drinks_count: 3 }];
    render(<AlcoholClient patientId="p1" />);
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText(/of a 7 drinks\/week goal/)).toBeTruthy();
  });
});
