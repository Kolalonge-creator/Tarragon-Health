/** @jest-environment jsdom */
/**
 * The invoiced total on a settlement statement is read exactly or refused, and the line under the box shows
 * the same reading the save uses, so a value that would be refused never shows "Issuing ₦…".
 *
 * The box is a number input, which already stops commas, spaces and letters. What it allows is scientific notation and
 * extra decimals, so those are tested.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
const create = jest.fn(async () => ({ message: "Created" }));
jest.mock("./actions", () => ({
  createSettlementAction: (...a: unknown[]) => (create as (...x: unknown[]) => unknown)(...a),
  setSettlementStatusAction: jest.fn(),
}));

import { SettlementsManager } from "./settlements-manager";

beforeEach(() => create.mockClear());

const setup = () => {
  render(<SettlementsManager organisationId="o1" settlements={[]} />);
  fireEvent.change(screen.getByLabelText("Period start"), { target: { value: "2026-10-01" } });
  fireEvent.change(screen.getByLabelText("Period end"), { target: { value: "2026-10-31" } });
  return screen.getByLabelText("Invoiced (₦)") as HTMLInputElement;
};
const submit = (box: HTMLInputElement) => fireEvent.submit(box.closest("form") as HTMLFormElement);

describe("invoiced total", () => {
  it("echoes the exact amount and sends whole kobo", async () => {
    const box = setup();
    fireEvent.change(box, { target: { value: "1250.50" } });
    expect(screen.getByText("Issuing ₦1,250.50")).toBeTruthy();
    submit(box);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(((create.mock.calls[0] as unknown as [unknown, FormData])[1]).get("invoicedTotalKobo")).toBe("125050");
  });

  it.each(["1e3", "12.345"])("shows the reason, not a figure, for %s and saves nothing", (value) => {
    const box = setup();
    fireEvent.change(box, { target: { value } });
    expect(screen.getByRole("alert").textContent).toMatch(/is not an amount|decimal places/);
    expect(screen.queryByText(/^Issuing/)).toBeNull();
    submit(box);
    expect(screen.getByText(/^Invoiced total: /)).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it("asks for the total when it is blank", () => {
    const box = setup();
    submit(box);
    expect(screen.getByText("Enter the invoiced total in naira.")).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });
});
