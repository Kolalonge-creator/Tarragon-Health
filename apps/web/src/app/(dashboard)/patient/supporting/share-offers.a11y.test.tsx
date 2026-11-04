/**
 * @jest-environment jsdom
 */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { ShareOffers } from "./share-offers";

// Care Circle P1 (founder decision D3, 2026-11-04): the person who paid is asked, and sees nothing until they say yes.
let offers: { isSuccess: boolean; data: unknown[] };
const respond = jest.fn<(input: { memberId: string; accept: boolean }) => Promise<{ ok: true; accepted: boolean }>>();
let respondState: { isPending: boolean; isError: boolean };
jest.mock("@/lib/queries/care-circle", () => {
  const actual = jest.requireActual<typeof import("@/lib/queries/care-circle")>("@/lib/queries/care-circle");
  return {
    ...actual,
    useShareOffers: () => offers,
    useRespondShareOffer: () => ({ mutateAsync: respond, ...respondState }),
  };
});

const OFFER = {
  member_id: "6c1d7e4a-1f2b-4c3d-9e8f-0a1b2c3d4e5f",
  patient_id: "7d2e8f5b-2a3c-4d4e-8f9a-1b2c3d4e5f6a",
  name: "Adaeze",
  permissions: ["weekly_bp_trend", "appointments", "not_a_permission"],
  monthly_report: true,
  offered_at: "2026-11-04T10:00:00Z",
  answer_by: "2026-11-18T10:00:00Z",
};

beforeEach(() => {
  offers = { isSuccess: true, data: [OFFER] };
  respondState = { isPending: false, isError: false };
  respond.mockReset();
});

describe("ShareOffers", () => {
  it("shows nothing when there is nothing to answer, or the read failed", () => {
    offers = { isSuccess: true, data: [] };
    const { container } = render(<ShareOffers locale="en" />);
    expect(container.textContent).toBe("");
    cleanup();
    offers = { isSuccess: false, data: [] };
    const again = render(<ShareOffers locale="en" />);
    expect(again.container.textContent).toBe("");
  });

  it("names the person by first name, lists only what they would see, and the deadline", async () => {
    render(<ShareOffers locale="en" />);
    expect(screen.getByRole("heading", { name: "Adaeze has asked you to join their Care Circle" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/Please answer by/)).toBeTruthy();
    cleanup();
    await expectNoA11yViolations(<ShareOffers locale="en" />);
  });

  it("Yes sends accept for that offer and confirms", async () => {
    respond.mockResolvedValue({ ok: true, accepted: true });
    render(<ShareOffers locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Yes, join" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/You have joined Adaeze's Care Circle/));
    expect(respond).toHaveBeenCalledWith({ memberId: OFFER.member_id, accept: true });
  });

  it("No sends decline and says nothing will be shared", async () => {
    respond.mockResolvedValue({ ok: true, accepted: false });
    render(<ShareOffers locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "No, thank you" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Nothing will be shared with you/));
    expect(respond).toHaveBeenCalledWith({ memberId: OFFER.member_id, accept: false });
  });

  it("a failed answer says so and leaves both buttons", async () => {
    respond.mockRejectedValue(new Error("circle_offer_not_found"));
    respondState = { isPending: false, isError: true };
    render(<ShareOffers locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Yes, join" }));
    expect(screen.getByRole("alert").textContent).toMatch(/did not work/);
    expect(screen.getByRole("button", { name: "No, thank you" })).toBeTruthy();
  });
});
