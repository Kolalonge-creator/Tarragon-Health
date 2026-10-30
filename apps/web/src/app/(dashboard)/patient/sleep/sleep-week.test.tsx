/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { SleepWeek, lastSevenDays } from "./sleep-week";

describe("SleepWeek", () => {
  it("lists the seven days ending today, oldest first", () => {
    const d = lastSevenDays("2026-10-29");
    expect(d).toHaveLength(7);
    expect(d[0]).toBe("2026-10-23");
    expect(d[6]).toBe("2026-10-29");
  });
  it("draws a bar for logged nights and an empty slot (not a zero) for missed ones", () => {
    render(<SleepWeek today="2026-10-29" entries={[{ logged_on: "2026-10-29", duration_hours: 7.5 }]} />);
    expect(screen.getAllByRole("listitem", { name: /not logged/ })).toHaveLength(6);
    expect(screen.getByRole("listitem", { name: /7.5 hours/ })).toBeTruthy();
  });
  it("renders nothing when no night in the last 7 days was logged", () => {
    const { container } = render(<SleepWeek today="2026-10-29" entries={[{ logged_on: "2026-09-01", duration_hours: 8 }]} />);
    expect(container.innerHTML).toBe("");
  });
  it("shows the goal line only when a goal exists", () => {
    const e = [{ logged_on: "2026-10-28", duration_hours: 6 }];
    const { rerender } = render(<SleepWeek today="2026-10-29" entries={e} goalHours={8} />);
    expect(screen.getByTestId("sleep-goal-line")).toBeTruthy();
    rerender(<SleepWeek today="2026-10-29" entries={e} goalHours={null} />);
    expect(screen.queryByTestId("sleep-goal-line")).toBeNull();
  });
});
