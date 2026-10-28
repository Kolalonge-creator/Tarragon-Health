/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { FollowWithDoctorCard } from "./follow-with-doctor-card";
import { markRedAcknowledgedThisSession } from "./red-session";

const mockMembership = jest.fn();
const mockEmergency = jest.fn();
const mockGuidance = jest.fn();
jest.mock("@/lib/queries/commerce", () => ({ useMyMembership: () => ({ data: mockMembership() }) }));
jest.mock("@/lib/queries/emergency", () => ({ useActiveEmergency: () => ({ data: mockEmergency() }) }));
jest.mock("@/lib/queries/free-red-checkin", () => ({ useFreeGuidance: () => ({ data: mockGuidance() }) }));

const ui = <FollowWithDoctorCard patientId="p1" priceLabel="84,000" refundDays={21} />;

beforeEach(() => {
  window.sessionStorage.clear();
  mockMembership.mockReturnValue({ is_member: false });
  mockEmergency.mockReturnValue(null);
  mockGuidance.mockReturnValue(null);
});

describe("FollowWithDoctorCard (W-53 calm-screen Membership offer)", () => {
  it("shows the price and the refund window beside the link for a Free person on a calm screen", () => {
    const { container } = render(ui);
    expect(screen.getByText("A doctor can follow this with you")).toBeTruthy();
    expect(container.textContent).toContain("84,000");
    expect(container.textContent).toContain("21 days");
    expect(screen.getByRole("link", { name: "See Membership" }).getAttribute("href")).toBe("/patient/membership");
    expect(container.textContent).not.toMatch(/hurry|limited|expires|—|–/i);
  });
  it("is hidden for a Member and while membership is still loading", () => {
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
