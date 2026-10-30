/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";

const mockHistory = jest.fn();
jest.mock("@/lib/queries/pharmacist", () => ({ usePharmacistDispenseHistory: () => mockHistory() }));

import { PharmacistHistory } from "./pharmacist-history";

const ROW = { dispense_id: "d1", patient_name: "Ada Test", drug_name: "Amlodipine", quantity: null, dispensed_on: "2026-10-29" };

describe("PharmacistHistory", () => {
  it("says nothing was dispensed only when the read worked and returned no rows", () => {
    mockHistory.mockReturnValue({ data: [], isLoading: false, isError: false });
    render(<PharmacistHistory />);
    expect(screen.getByText("Nothing dispensed yet.")).toBeTruthy();
  });

  it("warns, and does not say nothing was dispensed, when the read failed", () => {
    mockHistory.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<PharmacistHistory />);
    expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded/);
    expect(screen.queryByText("Nothing dispensed yet.")).toBeNull();
  });

  it("keeps the rows and marks them out of date when a refresh failed", () => {
    mockHistory.mockReturnValue({ data: [ROW], isLoading: false, isError: true });
    render(<PharmacistHistory />);
    expect(screen.getByText("Ada Test")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/may be out of date/);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says Not recorded for a missing quantity instead of a dash", () => {
    mockHistory.mockReturnValue({ data: [ROW], isLoading: false, isError: false });
    render(<PharmacistHistory />);
    expect(screen.getByText("Not recorded")).toBeTruthy();
  });
});
