/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { JoinWaitlist } from "./join-waitlist";

const status = { isLoading: false, isError: false, data: false as boolean | undefined };
const mutate = jest.fn();
const setState = { isPending: false, isError: false, mutate };

jest.mock("@/lib/queries/feature-waitlist", () => ({ useOnWaitlist: () => status, useSetWaitlist: () => setState }));

describe("JoinWaitlist", () => {
  beforeEach(() => {
    status.isLoading = false;
    status.isError = false;
    status.data = false;
    setState.isError = false;
    mutate.mockClear();
  });
  it("offers to join and sends join = true", () => {
    render(<JoinWaitlist feature="directory" />);
    fireEvent.click(screen.getByRole("button", { name: "Keep me on the list" }));
    expect(mutate).toHaveBeenCalledWith(true);
  });
  it("shows the joined state and lets the person leave", () => {
    status.data = true;
    render(<JoinWaitlist feature="directory" />);
    expect(screen.getByText(/You are on the list/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take me off the list" }));
    expect(mutate).toHaveBeenCalledWith(false);
  });
  it("shows nothing while unknown or when the read failed (never guesses 'not on the list')", () => {
    status.isLoading = true;
    const { container, rerender } = render(<JoinWaitlist feature="directory" />);
    expect(container.innerHTML).toBe("");
    status.isLoading = false;
    status.isError = true;
    rerender(<JoinWaitlist feature="directory" />);
    expect(container.innerHTML).toBe("");
  });
  it("says so when saving failed", () => {
    setState.isError = true;
    render(<JoinWaitlist feature="directory" />);
    expect(screen.getByRole("alert").textContent).toMatch(/could not save/);
  });
});
