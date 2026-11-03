/** @jest-environment jsdom */
/**
 * A gift waiting for the patient's yes (S29b): says what was paid for and by when to answer, does nothing until the patient presses a
 * button, asks before declining, and shows the result. Renders nothing when there is nothing waiting. Axe-clean.
 * 2026-11-03: after a yes, the "would you like [name] to see how you are doing?" step opens for the payer of THAT gift, with nothing
 * ticked and nothing sent; a decline opens no such step.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { PendingGifts } from "./pending-gifts";

let gifts: { data: unknown[] };
let payers: { data: unknown[]; isLoading: boolean };
const mutateAsync = jest.fn();
const share = jest.fn();
jest.mock("@/lib/queries/care-circle", () => ({
  usePendingGifts: () => gifts,
  useRespondToGift: () => ({ mutateAsync, isPending: false }),
  useGiftPayers: () => payers,
  useShareWithGiftPayer: () => ({ mutateAsync: share, isPending: false }),
  useDismissGiftPayer: () => ({ mutate: jest.fn(), isPending: false }),
}));

const GIFT = { entitlement_id: "e1", name_key: "catalog.membership_annual.name", paid_at: "2026-10-06T10:00:00Z", decide_by: "2026-11-05T10:00:00Z" };
const PAYER = { payer_id: "8b0e1f4e-7d55-4a9b-9a51-1f5f0d6b2c11", first_name: "Chinedu", entitlement_ids: ["e1"], last_gift_at: "2026-11-03T10:00:00Z", is_member: false };
beforeEach(() => {
  gifts = { data: [GIFT] };
  payers = { data: [], isLoading: false };
  mutateAsync.mockReset();
  share.mockReset();
});

describe("PendingGifts", () => {
  it("says what was paid for, that nothing starts until yes, and by when to answer", async () => {
    render(<PendingGifts locale="en" />);
    expect(screen.getByText("Someone has paid for care for you")).toBeTruthy();
    expect(screen.getByText(/Membership Plus\. Nothing starts until you say yes\./)).toBeTruthy();
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
    expect(screen.getAllByRole("status")[0]!.textContent).toMatch(/Accepted/);
  });

  it("after a yes, asks whether the payer may see how the patient is doing, with nothing ticked and nothing sent", async () => {
    mutateAsync.mockResolvedValue("accepted");
    const { rerender } = render(<PendingGifts locale="en" />);
    expect(screen.queryByText(/Would you like Chinedu/)).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Accept" })));
    payers = { data: [PAYER], isLoading: false };
    gifts = { data: [] };
    rerender(<PendingGifts locale="en" />);
    expect(screen.getByRole("heading", { name: "Would you like Chinedu to see how you are doing?" })).toBeTruthy();
    for (const box of screen.getAllByRole("checkbox")) expect((box as HTMLInputElement).checked).toBe(false);
    expect(share).not.toHaveBeenCalled();
  });

  it("asks before declining, and does nothing on cancel; a decline opens no share step", async () => {
    const confirm = jest.spyOn(window, "confirm");
    confirm.mockReturnValueOnce(false).mockReturnValueOnce(true);
    mutateAsync.mockResolvedValue("declined");
    payers = { data: [{ ...PAYER, entitlement_ids: ["other"] }], isLoading: false };
    render(<PendingGifts locale="en" />);
    const no = screen.getByRole("button", { name: "No thank you" });
    await act(async () => fireEvent.click(no));
    expect(mutateAsync).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(no));
    expect(mutateAsync).toHaveBeenCalledWith({ entitlementId: "e1", accept: false });
    expect(screen.getAllByRole("status")[0]!.textContent).toMatch(/Nothing was started/);
    expect(screen.queryByRole("heading", { name: /Would you like/ })).toBeNull();
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
