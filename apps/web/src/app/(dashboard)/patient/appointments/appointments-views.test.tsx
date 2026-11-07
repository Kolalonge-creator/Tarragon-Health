/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { AppointmentsViews } from "./appointments-views";

jest.mock("./my-appointments-list", () => ({ MyAppointmentsList: () => <div data-testid="upcoming" /> }));
jest.mock("./appointment-history-list", () => ({
  AppointmentHistoryList: ({ view }: { view: string }) => <div data-testid="history">{view}</div>,
}));

describe("AppointmentsViews", () => {
  it("starts on Upcoming with aria-pressed, and switches to each history view", () => {
    render(<AppointmentsViews patientId="p1" isSelf />);
    expect(screen.getByTestId("upcoming")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upcoming" }).getAttribute("aria-pressed")).toBe("true");
    for (const [label, view] of [["Past", "past"], ["Cancelled", "cancelled"], ["Missed", "missed"]] as const) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(screen.getByRole("button", { name: label }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByRole("button", { name: "Upcoming" }).getAttribute("aria-pressed")).toBe("false");
      expect(screen.getByTestId("history").textContent).toBe(view);
      expect(screen.queryByTestId("upcoming")).toBeNull();
    }
  });
});
