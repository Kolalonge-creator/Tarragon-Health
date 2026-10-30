/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { AboveTargetMembershipCard } from "./above-target-membership-card";
import { markRedAcknowledgedThisSession } from "./red-session";

const mockOffer = jest.fn();
const mockMembership = jest.fn();
const mockEmergency = jest.fn();
const mockGuidance = jest.fn();
jest.mock("@/lib/queries/commerce", () => ({
  useMyMembershipOffer: () => ({ data: mockOffer() }),
  useMyMembership: () => ({ data: mockMembership() }),
}));
jest.mock("@/lib/queries/emergency", () => ({ useActiveEmergency: () => ({ data: mockEmergency() }) }));
jest.mock("@/lib/queries/free-red-checkin", () => ({ useFreeGuidance: () => ({ data: mockGuidance() }) }));

const ui = <AboveTargetMembershipCard patientId="p1" priceLabel="84,000" refundDays={21} />;

beforeEach(() => {
  window.sessionStorage.clear();
  mockOffer.mockReturnValue({ status: "offer" });
  mockMembership.mockReturnValue({ is_member: false });
  mockEmergency.mockReturnValue(null);
  mockGuidance.mockReturnValue(null);
});

describe("AboveTargetMembershipCard (journey 1: the Membership offer above target)", () => {
  it("shows the offer with the price and refund window when the database says offer", () => {
    const { container } = render(ui);
    expect(screen.getByText("Your readings this week are above your target")).toBeTruthy();
    expect(container.textContent).toContain("84,000");
    expect(container.textContent).toContain("21 days");
    expect(screen.getByRole("link", { name: "See Membership" }).getAttribute("href")).toBe("/patient/membership");
    expect(container.textContent).not.toMatch(/hurry|limited|expires|urgent|danger|—|–/i);
  });
  it("shows nothing unless the database says offer (not open, not eligible, loading, unreadable)", () => {
    for (const v of [{ status: "not_open_yet" }, { status: "not_eligible", reason: "within_target" }, { status: "not_eligible", reason: "unreadable" }, undefined]) {
      mockOffer.mockReturnValue(v);
      expect(render(ui).container.innerHTML).toBe("");
    }
  });
  it("is hidden for a Member and while membership is loading", () => {
    mockMembership.mockReturnValue({ is_member: true });
    expect(render(ui).container.innerHTML).toBe("");
    mockMembership.mockReturnValue(undefined);
    expect(render(ui).container.innerHTML).toBe("");
  });
  it("is hidden while a red state is open, while amber guidance is open, and after a red state was acknowledged this session", () => {
    mockEmergency.mockReturnValue({ id: "e1" });
    expect(render(ui).container.innerHTML).toBe("");
    mockEmergency.mockReturnValue(null);
    mockGuidance.mockReturnValue({ id: "g1" });
    expect(render(ui).container.innerHTML).toBe("");
    mockGuidance.mockReturnValue(null);
    markRedAcknowledgedThisSession();
    expect(render(ui).container.innerHTML).toBe("");
  });
});
