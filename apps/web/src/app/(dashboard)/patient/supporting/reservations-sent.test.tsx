/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";

const hook = jest.fn();
jest.mock("@/lib/queries/sponsorship", () => ({ useSponsoredReservations: () => hook() }));

import { ReservationsSent } from "./reservations-sent";

const base = { recipientFirstName: "Amaka", recipientPhone: "+2348012345678", serviceName: "Check", amountKobo: 500000, createdAt: "2026-10-01", claimedAt: null };

describe("ReservationsSent", () => {
  it("shows the sponsor a link to give the person while the reservation is waiting, and says no text is sent", () => {
    hook.mockReturnValue({ isLoading: false, data: [{ ...base, id: "a", status: "invited", inviteToken: "tok123" }] });
    render(<ReservationsSent />);
    expect((screen.getByLabelText("Claim link for Amaka") as HTMLInputElement).value).toMatch(/\/claim\/tok123$/);
    expect(screen.getByText(/We do not text them/)).toBeTruthy();
    expect(screen.getByText("Copy link")).toBeTruthy();
  });
  it("shows no link once claimed or when there is no token", () => {
    hook.mockReturnValue({ isLoading: false, data: [{ ...base, id: "b", status: "claimed", inviteToken: null }] });
    render(<ReservationsSent />);
    expect(screen.queryByText("Copy link")).toBeNull();
  });
});
