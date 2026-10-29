/** @jest-environment jsdom */
/** This week's progress comes from the real workout log; it is hidden when the safety gate says rest, and a failed read is never a zero. */
import { render, screen } from "@testing-library/react";
import { ExerciseClient } from "./exercise-client";

const weekly = { isLoading: false, isError: false, data: 90 as number | undefined };
const gateState = { data: { gate: { decision: "ok" } } as unknown };

const goalState = { data: { weekly_active_minutes_goal: 100 } as { weekly_active_minutes_goal: number } | null };
jest.mock("@/lib/queries/activity", () => ({ useWeeklyActivityMinutes: () => weekly, useActivityGoal: () => goalState }));
jest.mock("@/lib/queries/exercise", () => ({
  useExerciseProgrammes: () => ({ data: [] }),
  useLatestReadinessScreen: () => ({ data: null }),
  useExerciseEnrollments: () => ({ isLoading: false, data: [] }),
  clearsForModerate: () => false,
  clearsForVigorous: () => false,
}));
jest.mock("@/lib/queries/activity-gate", () => ({ useActivityGate: () => gateState, useWorkoutPlans: () => ({ data: [] }) }));
jest.mock("@/lib/queries/patient-demographics", () => ({ usePatientChronologicalAge: () => ({ data: 40 }) }));
jest.mock("@/components/activity/activity-gate-banner", () => ({ ActivityGateBanner: () => null }));
jest.mock("./actions", () => ({ submitReadinessScreenAction: jest.fn(), enrollExerciseProgrammeAction: jest.fn() }));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));

describe("Exercise page weekly progress", () => {
  beforeEach(() => {
    weekly.isError = false;
    weekly.data = 90;
    gateState.data = { gate: { decision: "ok" } };
  });
  it("shows the minutes from the workout log", () => {
    render(<ExerciseClient patientId="p1" />);
    expect(screen.getByText("90")).toBeTruthy();
    expect(screen.getByText(/of 100 minutes/)).toBeTruthy();
  });
  it("falls back to the 150-minute guideline when there is no saved goal", () => {
    goalState.data = null;
    render(<ExerciseClient patientId="p1" />);
    expect(screen.getByText(/of 150 minutes/)).toBeTruthy();
    goalState.data = { weekly_active_minutes_goal: 100 };
  });
  it("a failed read is a retry line, not a zero", () => {
    weekly.isError = true;
    weekly.data = undefined;
    render(<ExerciseClient patientId="p1" />);
    expect(screen.getByText(/couldn't load this week's activity/i)).toBeTruthy();
    expect(screen.queryByText(/Nothing logged/)).toBeNull();
  });
  it("is not shown while the gate says rest", () => {
    gateState.data = { gate: { decision: "rest" } };
    render(<ExerciseClient patientId="p1" />);
    expect(screen.queryByText(/Active this week/)).toBeNull();
  });
});
