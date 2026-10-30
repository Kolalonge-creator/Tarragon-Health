/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";

const mockOrders = jest.fn();
const mockDispenses = jest.fn();
const mockProfile = jest.fn();

jest.mock("@/lib/queries/pharmacist", () => ({
  usePharmacistOrders: () => mockOrders(),
  usePharmacistDispenseHistory: () => mockDispenses(),
  usePharmacistProfile: () => mockProfile(),
}));

import { PharmacistOverview } from "./pharmacist-overview";

const ok = <T,>(data: T) => ({ data, isLoading: false, isError: false });
const loading = { data: undefined, isLoading: true, isError: false };
const failed = { data: undefined, isLoading: false, isError: true };
const stale = <T,>(data: T) => ({ data, isLoading: false, isError: true });

const ORDER = {
  order_id: "o1",
  order_number: null,
  status: "payment_confirmed",
  patient_name: "Ada Test",
  patient_number: null,
  items: [{ drug_name: "Amlodipine", quantity: 30 }],
  requested_at: new Date().toISOString(),
  payable_kobo: null,
  confirmed_quantity: null,
  confirmed_price_kobo: null,
  estimated_fulfilment_at: null,
  cancellation_reason: null,
};
const PROFILE = {
  name: "Test Pharmacy",
  regions: ["Lagos"],
  city: null,
  state: null,
  contact_phone: null,
  contact_email: null,
  license_number: "PCN-1",
  license_expires_at: "2099-01-31",
};

function setAll(p: { o?: unknown; d?: unknown; pr?: unknown }) {
  mockOrders.mockReturnValue(p.o ?? ok([ORDER]));
  mockDispenses.mockReturnValue(p.d ?? ok([]));
  mockProfile.mockReturnValue(p.pr ?? ok(PROFILE));
}

describe("PharmacistOverview", () => {
  it("lists a waiting order and does not say caught up", () => {
    setAll({});
    render(<PharmacistOverview />);
    expect(screen.getByText("Ada Test")).toBeTruthy();
    expect(screen.queryByText(/You.re caught up/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says caught up only when the orders were read and none are open", () => {
    setAll({ o: ok([]) });
    render(<PharmacistOverview />);
    expect(screen.getByText(/You.re caught up/)).toBeTruthy();
  });

  it("warns, and does not say caught up or show zero, when the orders failed", () => {
    setAll({ o: failed });
    const { container } = render(<PharmacistOverview />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/orders could not be loaded/);
    expect(alert.textContent).toMatch(/does not mean there are none/);
    expect(screen.queryByText(/You.re caught up/)).toBeNull();
    expect(screen.getAllByText("Could not be loaded").length).toBeGreaterThanOrEqual(3);
    expect(container.textContent).not.toMatch(/Orders awaiting0/);
  });

  it("shows Loading, not zero or caught up, while everything is loading", () => {
    setAll({ o: loading, d: loading, pr: loading });
    const { container } = render(<PharmacistOverview />);
    expect(screen.queryByText(/You.re caught up/)).toBeNull();
    expect(screen.queryByText(/Nothing dispensed yet today/)).toBeNull();
    expect(screen.queryByText(/No pharmacy profile on file/)).toBeNull();
    expect(container.textContent).not.toMatch(/Orders awaiting0/);
  });

  it("keeps the last orders and marks them out of date when a refresh failed", () => {
    setAll({ o: stale([ORDER]) });
    render(<PharmacistOverview />);
    expect(screen.getByText("Ada Test")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/may be out of date/);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not claim caught up from a stale empty list", () => {
    setAll({ o: stale([]) });
    render(<PharmacistOverview />);
    expect(screen.queryByText(/You.re caught up/)).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("warns, and does not say nothing was dispensed, when the history failed", () => {
    setAll({ d: failed });
    render(<PharmacistOverview />);
    expect(screen.getByRole("alert").textContent).toMatch(/dispensing history could not be loaded/);
    expect(screen.queryByText(/Nothing dispensed yet today/)).toBeNull();
  });

  it("warns, and does not say no profile is on file, when the profile failed", () => {
    setAll({ pr: failed });
    render(<PharmacistOverview />);
    expect(screen.getByRole("alert").textContent).toMatch(/pharmacy details could not be loaded/);
    expect(screen.queryByText(/No pharmacy profile on file/)).toBeNull();
  });

  it("says no profile on file only when the profile was read and is empty", () => {
    setAll({ pr: ok(null) });
    render(<PharmacistOverview />);
    expect(screen.getByText(/No pharmacy profile on file yet/)).toBeTruthy();
  });

  it("flags an expired licence", () => {
    setAll({ pr: ok({ ...PROFILE, license_expires_at: "2020-01-31" }) });
    render(<PharmacistOverview />);
    expect(screen.getByText("(Expired)")).toBeTruthy();
  });
});
