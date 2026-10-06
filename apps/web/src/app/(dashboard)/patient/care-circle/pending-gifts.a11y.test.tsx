/** @jest-environment jsdom */
/**
 * A gift waiting for the patient's yes (S29b): says what was paid for and by when to answer, does nothing until the patient presses a
 * button, asks before declining, and shows the result. Renders nothing when there is nothing waiting. Axe-clean.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { PendingGifts } from "./pending-gifts";

let gifts: { data: unknown[] };
const mutateAsync = jest.fn();
jest.mock("@/lib/queries/care-circle", () => ({
  usePendingGifts: () => gifts,
  useRespondToGift: () => ({ mutateAsync, isPending: false }),
}));

const GIFT = { entitlement_id: "e1", name_key: "catalog.membership_annual.name", paid_at: "2026-10-06T10:00:00Z", decide_by: "2026-11-05T10:00:00Z" };
beforeEach(() => {
  gifts = { data: [GIFT] };
  mutateAsync.mockReset();
});

describe("PendingGifts", () => {
  it("says what was paid for, that nothing starts until yes, and by when to answer", async () => {
    render(<PendingGifts locale="en" />);
    expect(screen.getByText("Someone has paid for care for you")).toBeTruthy();
    expect(screen.getByText(/Tarragon Membership\. Nothing starts until you say yes\./)).toBeTruthy();
    expect(screen.getByText(/Please answer by/)).toBeTruthy();
    cleanup();
    await expectNoA11yViolations(<PendingGifts locale="en" />);
  });

  it("does nothing until the patient presses a button, then sends the answer", async () => {
    mutateAsync.mockResolvedValue("accepted");
    render(<PendingGifts locale="en" />);
    expect(mutateAsync).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Accept" })));
    expect(mutateAsync).toHaveBeenCalledWith({ entitlementId: "e1", accept: true });
    expect(screen.getByRole("status").textContent).toMatch(/Accepted/);
  });

  it("asks before declining, and does nothing on cancel", async () => {
    const confirm = jest.spyOn(window, "confirm");
    confirm.mockReturnValueOnce(false).mockReturnValueOnce(true);
    mutateAsync.mockResolvedValue("declined");
    render(<PendingGifts locale="en" />);
    const no = screen.getByRole("button", { name: "No thank you" });
    await act(async () => fireEvent.click(no));
    expect(mutateAsync).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(no));
    expect(mutateAsync).toHaveBeenCalledWith({ entitlementId: "e1", accept: false });
    expect(screen.getByRole("status").textContent).toMatch(/Nothing was started/);
    confirm.mockRestore();
  });

  it("shows a plain error when the answer could not be saved", async () => {
    mutateAsync.mockRejectedValue(new Error("x"));
    render(<PendingGifts locale="en" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Accept" })));
    expect(screen.getByRole("alert").textContent).toMatch(/could not save your answer/);
  });

  it("renders nothing when nothing is waiting", () => {
    gifts = { data: [] };
    const { container } = render(<PendingGifts locale="en" />);
    expect(container.textContent).toBe("");
  });
});
