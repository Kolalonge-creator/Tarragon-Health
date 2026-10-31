/** @jest-environment jsdom */
/**
 * The contract form echoes what a typed rate comes to before it drives a recurring invoice. It used to read the
 * box with the loose admin parser, so a value the server would not accept still showed a confident figure. It now
 * reads it as the save does: the same amount, or the reason it cannot be read.
 */
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("../actions", () => ({
  updateEmployerProfileAction: jest.fn(),
  setEmployerVerificationAction: jest.fn(),
  upsertEmployerContractAction: jest.fn(),
  goLiveEmployerAction: jest.fn(),
}));
jest.mock("./seat-pilot-panel", () => ({ SeatPilotPanel: () => null }));

import { EmployerDetailManager } from "./employer-detail-manager";

function setup(rosterCount = 40) {
  render(<EmployerDetailManager organisationId="o1" organisationName="Acme Ltd" account={null} contract={null} rosterCount={rosterCount} />);
  return {
    rate: screen.getByLabelText(/Rate \(₦, per person\)/) as HTMLInputElement,
    fixed: screen.getByLabelText(/Fixed amount/) as HTMLInputElement,
  };
}
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

describe("billing amount echo", () => {
  it("shows what a readable rate comes to", () => {
    const { rate } = setup();
    type(rate, "1500.50");
    expect(screen.getByText(/₦1,500\.50 per person, ₦60,020\.00 for the 40 on the roster/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the reason, not a figure, for a rate the save would refuse", () => {
    const { rate } = setup();
    type(rate, "12.345");
    expect(screen.getByRole("alert").textContent).toContain("more than two decimal places");
    expect(screen.queryByText(/per person,/)).toBeNull();
  });

  it("refuses scientific notation that a number box allows", () => {
    const { fixed } = setup();
    type(fixed, "1e3");
    expect(screen.getByRole("alert").textContent).toContain("is not an amount");
  });

  it("goes back to the hint when the box is cleared", () => {
    const { rate } = setup();
    type(rate, "12.345");
    type(rate, "");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Amount in naira, per person")).toBeTruthy();
  });
});
