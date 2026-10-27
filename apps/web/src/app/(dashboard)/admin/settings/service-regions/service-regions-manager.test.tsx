/** @jest-environment jsdom */
/** Withdrawing a state from Membership Plus asks first; approving does not; the page says the checkout does not read the flag yet. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ServiceRegionsManager } from "./service-regions-manager";

const setPlus = jest.fn();
const regions = [
  { id: "r1", state: "Lagos", display_name: "Lagos", is_active: true, activated_at: "2026-07-17T00:00:00Z", plus_collection_enabled: true },
  { id: "r2", state: "Kano", display_name: "Kano", is_active: false, activated_at: null, plus_collection_enabled: false },
];
jest.mock("@/lib/queries/service-regions", () => ({
  useServiceRegions: () => ({ data: regions, isLoading: false, isError: false }),
  useSetServiceRegionActive: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
  useSetServicePlusCollection: () => ({ mutate: setPlus, isPending: false, isError: false }),
  useOpenWaitlistCounts: () => ({ data: {} }),
}));
afterEach(() => { cleanup(); setPlus.mockReset(); jest.restoreAllMocks(); });

describe("ServiceRegionsManager Plus approval", () => {
  it("asks before withdrawing a state, and does nothing when the admin says no", () => {
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
    render(<ServiceRegionsManager />);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw Plus" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(String(confirm.mock.calls[0]![0])).toMatch(/Lagos/);
    expect(setPlus).not.toHaveBeenCalled();
  });

  it("withdraws once the admin confirms", () => {
    jest.spyOn(window, "confirm").mockReturnValue(true);
    render(<ServiceRegionsManager />);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw Plus" }));
    expect(setPlus).toHaveBeenCalledWith({ id: "r1", enabled: false });
  });

  it("approving a state needs no confirmation", () => {
    const confirm = jest.spyOn(window, "confirm");
    render(<ServiceRegionsManager />);
    fireEvent.click(screen.getByRole("button", { name: "Approve for Plus" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(setPlus).toHaveBeenCalledWith({ id: "r2", enabled: true });
  });

  it("says plainly that the Plus checkout does not read the approval yet", () => {
    render(<ServiceRegionsManager />);
    expect(screen.getByText(/does not read it yet/)).toBeTruthy();
  });
});
