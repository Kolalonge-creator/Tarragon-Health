/** @jest-environment jsdom */
/** Annual bundle: open to every plan; partner lab path needs a chosen branch, own-lab path needs none; a live bundle shows its form instead. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { AnnualBundleCard } from "./annual-bundle-card";

const mutate = jest.fn();
let orders: unknown[] = [];
let labs: unknown[] = [];
jest.mock("@/lib/queries/lab-orders", () => ({ usePatientLabOrders: () => ({ data: orders }) }));
jest.mock("@/lib/queries/annual-bundle", () => ({
  useAnnualBundleTowns: () => ({ data: [{ town: "Ibadan", lab_count: 1 }] }),
  useAnnualBundleLabs: () => ({ data: labs, isLoading: false, isError: false }),
  useStartAnnualBundle: () => ({ mutate, isPending: false, isError: false }),
}));
afterEach(() => {
  cleanup();
  mutate.mockReset();
  orders = [];
  labs = [];
});

const lab = {
  location_id: "loc-1", provider_name: "Synlab", location_name: "Ibadan Lab", town: "Ibadan", state: "Oyo",
  address: "1 Aperin Street, Old Bodija, Ibadan", contact_phone: null, opening_hours: null,
};

describe("AnnualBundleCard", () => {
  it("has no accessibility violations", async () => {
    await expectNoA11yViolations(<AnnualBundleCard patientId="p" />);
  });

  it("the start button is disabled until a way of doing the tests is chosen", () => {
    render(<AnnualBundleCard patientId="p" />);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("own-lab path starts the bundle with no location", () => {
    render(<AnnualBundleCard patientId="p" />);
    fireEvent.click(screen.getByLabelText(/any other lab near me/));
    fireEvent.click(screen.getByRole("button", { name: /Get my request form/ }));
    expect(mutate).toHaveBeenCalledWith(null);
  });

  it("partner path needs a branch, shows its address, and starts with that branch", () => {
    labs = [lab];
    render(<AnnualBundleCard patientId="p" />);
    fireEvent.click(screen.getByLabelText(/Tarragon partner lab near me/));
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "Oyo" } });
    expect(screen.getByText(/1 Aperin Street/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Get my request form/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Synlab Ibadan Lab/));
    fireEvent.click(screen.getByRole("button", { name: /Get my request for Ibadan Lab/ }));
    expect(mutate).toHaveBeenCalledWith("loc-1");
  });

  it("a state with no partner lab points to the own-lab option instead of dead-ending", () => {
    render(<AnnualBundleCard patientId="p" />);
    fireEvent.click(screen.getByLabelText(/Tarragon partner lab near me/));
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "Kano" } });
    expect(screen.getByText(/no partner lab in Kano yet/)).toBeTruthy();
  });

  it("a bundle already started this year shows its download link, not the picker", () => {
    orders = [{ id: "o1", panel_code: "membership_annual", status: "ordered", ordered_at: new Date().toISOString() }];
    render(<AnnualBundleCard patientId="p" />);
    expect(screen.getByRole("link", { name: /Download the request form/ }).getAttribute("href")).toBe("/api/patient/lab-order/o1/request");
    expect(screen.queryByLabelText("State")).toBeNull();
  });
});
