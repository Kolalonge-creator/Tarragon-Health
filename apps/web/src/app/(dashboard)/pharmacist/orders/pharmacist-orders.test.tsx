/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";

const mockOrders = jest.fn();
jest.mock("@/lib/queries/pharmacist", () => ({
  usePharmacistOrders: () => mockOrders(),
  usePharmacistAcceptOrder: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
  usePharmacistDeclineOrder: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
  usePharmacistFlagUnavailable: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
  usePharmacistRecordDispense: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
  usePharmacistOrderAllergies: () => ({ data: [], isLoading: false }),
  usePharmacistOrderMedications: () => ({ data: [], isLoading: false }),
}));

import { PharmacistOrders } from "./pharmacist-orders";

describe("PharmacistOrders list", () => {
  it("says no orders only when the read worked and returned none", () => {
    mockOrders.mockReturnValue({ data: [], isLoading: false, isError: false });
    render(<PharmacistOrders />);
    expect(screen.getByText("No orders in this filter.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("warns, and does not say there are no orders, when the read failed", () => {
    mockOrders.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<PharmacistOrders />);
    expect(screen.getByRole("alert").textContent).toMatch(/orders could not be loaded/);
    expect(screen.getByRole("alert").textContent).toMatch(/does not mean there are none/);
    expect(screen.queryByText("No orders in this filter.")).toBeNull();
  });

  it("marks an empty list as out of date, not empty, when a refresh failed", () => {
    mockOrders.mockReturnValue({ data: [], isLoading: false, isError: true });
    render(<PharmacistOrders />);
    expect(screen.getByRole("status").textContent).toMatch(/may be out of date/);
    expect(screen.queryByText("No orders in this filter.")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
