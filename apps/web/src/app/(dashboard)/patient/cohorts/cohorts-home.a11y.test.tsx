/** @jest-environment jsdom */
/** UI-B change 14: the cohorts home shows an empty state (one sentence, one button) and a DIFFERENT could-not-load state with Try again. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { CommunityHome } from "./cohorts-home";

const refetch = jest.fn();
let mine: Record<string, unknown>;
jest.mock("@/lib/queries/cohorts", () => ({
  CommunityError: class CommunityError extends Error {},
  useMyCohorts: () => mine,
  useCommunityOff: () => ({ mutate: jest.fn(), isPending: false }),
  useCreateCohort: () => ({ mutate: jest.fn(), isPending: false, isError: false, error: null }),
}));

beforeEach(() => {
  refetch.mockReset();
  mine = { isPending: false, isError: false, refetch, data: { open: true, off: false, cohorts: [] } };
});

describe("CommunityHome states", () => {
  it("empty: one sentence and one button, and it is not the load-failed state", async () => {
    render(<CommunityHome locale="en" />);
    expect(screen.getByText(/You are not in a group yet/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create a group" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();
    await expectNoA11yViolations(<CommunityHome locale="en" />);
  });

  it("while Try again is running it shows a loading state, not the old error, and the button is disabled", () => {
    mine = { isPending: false, isError: true, isFetching: true, refetch, data: undefined };
    render(<CommunityHome locale="en" />);
    expect(screen.getByRole("status").textContent).toMatch(/Loading your groups/);
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByRole("button", { name: "Try again" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("could not load: says so, is not the empty sentence, and Try again refetches", async () => {
    mine = { isPending: false, isError: true, refetch, data: undefined };
    render(<CommunityHome locale="en" />);
    expect(screen.getByRole("alert").textContent).toMatch(/could not load your groups/);
    expect(screen.queryByText(/You are not in a group yet/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    cleanup();
    await expectNoA11yViolations(<CommunityHome locale="en" />);
  });
});
