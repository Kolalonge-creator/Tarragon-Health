/** @jest-environment jsdom */
/**
 * S06z: the My phones list. Calm removal wording that states the S06x rule, a change that fails says so and changes nothing on screen,
 * and a removed phone offers no actions.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PhoneView } from "@tarragon/shared";

const updateMyPhone = jest.fn();
const requestPhoneRemoval = jest.fn();
const fetchMyPhones = jest.fn();

jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
jest.mock("@/lib/my-health/my-phones", () => ({
  updateMyPhone: (...a: unknown[]) => updateMyPhone(...a),
  requestPhoneRemoval: (...a: unknown[]) => requestPhoneRemoval(...a),
  fetchMyPhones: (...a: unknown[]) => fetchMyPhones(...a),
}));

import { PhonesList } from "./phones-list";

const phone = (o: Partial<PhoneView>): PhoneView => ({
  deviceId: "d1",
  name: "Android phone",
  nameIsDefault: true,
  platform: "android",
  shared: false,
  status: "active",
  lastSeenAt: "2026-10-19T10:00:00Z",
  leaseExpiresAt: "2026-11-18T10:00:00Z",
  isThisPhone: false,
  unsentAtWipe: null,
  urgentAtWipe: null,
  ...o,
});

beforeEach(() => {
  jest.clearAllMocks();
  fetchMyPhones.mockResolvedValue({ ok: true, rows: [], dropped: 0 });
});

describe("PhonesList", () => {
  it("shows the empty state", () => {
    render(<PhonesList initial={[]} dropped={0} />);
    expect(screen.getByText(/No phones to show yet/)).toBeTruthy();
  });

  it("explains the rule before removing, and only then sends the request", async () => {
    requestPhoneRemoval.mockResolvedValue(true);
    render(<PhonesList initial={[phone({})]} dropped={0} />);
    fireEvent.click(screen.getByText("Remove this phone"));
    expect(screen.getByText(/one last try to send anything/)).toBeTruthy();
    expect(screen.getByText(/never dropped quietly/)).toBeTruthy();
    expect(requestPhoneRemoval).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Yes, remove it"));
    await waitFor(() => expect(requestPhoneRemoval).toHaveBeenCalledWith({}, "d1"));
    await waitFor(() => expect(screen.getByText(/will clear itself the next time it connects/)).toBeTruthy());
  });

  it("says so when the removal request fails", async () => {
    requestPhoneRemoval.mockResolvedValue(false);
    render(<PhonesList initial={[phone({})]} dropped={0} />);
    fireEvent.click(screen.getByText("Remove this phone"));
    fireEvent.click(screen.getByText("Yes, remove it"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Nothing was changed/));
  });

  it("a cleared phone shows the counts and offers no actions", () => {
    render(<PhonesList initial={[phone({ status: "wiped", unsentAtWipe: 3, urgentAtWipe: 1 })]} dropped={0} />);
    expect(screen.getByText(/3 entries had not been sent/)).toBeTruthy();
    expect(screen.queryByText("Remove this phone")).toBeNull();
    expect(screen.queryByText("Give it a name")).toBeNull();
  });

  it("marks a phone shared through the owner-only call", async () => {
    updateMyPhone.mockResolvedValue(true);
    render(<PhonesList initial={[phone({})]} dropped={0} />);
    fireEvent.click(screen.getByLabelText(/Other people use this phone/));
    await waitFor(() => expect(updateMyPhone).toHaveBeenCalledWith({}, "d1", { shared: true }));
  });

  it("warns when some rows could not be read", () => {
    render(<PhonesList initial={[phone({})]} dropped={2} />);
    expect(screen.getByText(/may be incomplete/)).toBeTruthy();
  });
});
