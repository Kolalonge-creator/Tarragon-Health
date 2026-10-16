/** @jest-environment jsdom */
/** S26b: declining a refund needs a reason the patient can read; an approved or declined answer closes the dialog; a failed refund can be sent back. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OrderRefundsAdmin } from "./order-refunds-admin";

const mutate = jest.fn();
const retryMutate = jest.fn();
let reply: { result: string } | null = null;

const refund = {
  id: "r1", order_id: "o1", amount_kobo: 1_200_000, reason: "Changed my mind", state: "pending", created_at: "2026-10-10T10:00:00Z",
  order: { amount_kobo: 1_200_000, state: "refunded", paid_at: null, catalog_item: { code: "care_pack_90", name_key: "catalog.care_pack.name" }, beneficiary: { full_name: "Ada" } },
  requester: { full_name: "Ada" },
};
const failedRefund = { id: "f1", order_id: "o2", amount_kobo: 500_000, attempts: 2, last_error_code: "provider_error", updated_at: "2026-10-11T10:00:00Z", patient_name: "Bola", name_key: null, code: "care_pack_90" };
const stuckRefund = { id: "s1", order_id: "o3", amount_kobo: 700_000, attempts: 1, processing_started_at: "2026-10-12T10:00:00Z", patient_name: "Chidi", name_key: null, code: "care_pack_90" };
const settleMutate = jest.fn();
let retryState: { data: unknown; isError: boolean } = { data: null, isError: false };

jest.mock("@/lib/queries/order-refunds", () => ({
  useAdminOrderRefunds: () => ({ data: [refund], isLoading: false, isError: false }),
  useAdminRefundOps: () => ({ data: { failed: [failedRefund], stuck: [stuckRefund] }, isError: false }),
  useSettleProcessingRefund: () => ({ isPending: false, isError: false, data: null, reset: jest.fn(), mutate: settleMutate }),
  useDecideOrderRefund: () => ({
    isPending: false, isError: false,
    mutate: (vars: unknown, opts: { onSuccess?: (d: unknown) => void }) => { mutate(vars); opts.onSuccess?.(reply); },
  }),
  useRetryFailedRefund: () => ({ isPending: false, data: retryState.data, isError: retryState.isError, reset: jest.fn(), mutate: retryMutate }),
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});
beforeEach(() => { mutate.mockClear(); retryMutate.mockClear(); settleMutate.mockClear(); reply = null; retryState = { data: null, isError: false }; });
afterEach(cleanup);

describe("OrderRefundsAdmin (S26b)", () => {
  it("a decline cannot be confirmed without a reason of at least 5 characters", () => {
    render(<OrderRefundsAdmin />);
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    const confirm = screen.getByRole("button", { name: "Deny request" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Reason \(required, shown to the patient\)/), { target: { value: "No" } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Reason \(required/), { target: { value: "Outside the window" } });
    expect(confirm.disabled).toBe(false);
    reply = { result: "rejected" };
    fireEvent.click(confirm);
    expect(mutate).toHaveBeenCalledWith({ refundId: "r1", approved: false, note: "Outside the window" });
  });

  it("an approval needs no note, and the real answer 'approved' is a success, not a refusal", () => {
    render(<OrderRefundsAdmin />);
    fireEvent.click(screen.getByRole("button", { name: "Approve refund" }));
    reply = { result: "approved" };
    fireEvent.click(screen.getAllByRole("button", { name: "Approve refund" }).at(-1)!);
    expect(mutate).toHaveBeenCalledWith({ refundId: "r1", approved: true, note: undefined });
    expect(screen.queryByText(/could not be decided/)).toBeNull();
  });

  it("shows the database's refusal instead of closing silently", () => {
    render(<OrderRefundsAdmin />);
    fireEvent.click(screen.getByRole("button", { name: "Approve refund" }));
    reply = { result: "already_decided" };
    fireEvent.click(screen.getAllByRole("button", { name: "Approve refund" }).at(-1)!);
    expect(screen.getByText(/Someone already decided this refund/)).toBeTruthy();
  });

  it("lists a failed refund with its attempts and sends it back to the queue only on a click", () => {
    render(<OrderRefundsAdmin />);
    expect(screen.getByText(/2 attempts/)).toBeTruthy();
    expect(retryMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send back to queue" }));
    expect(retryMutate).toHaveBeenCalledWith("f1");
  });

  it("an admin settles a stuck refund either way, only on a click", () => {
    render(<OrderRefundsAdmin />);
    expect(screen.getByText("Refunds stuck mid-send")).toBeTruthy();
    expect(settleMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Paystack sent it" }));
    expect(settleMutate).toHaveBeenCalledWith({ refundId: "s1", paid: true });
    fireEvent.click(screen.getByRole("button", { name: "Paystack did not send it" }));
    expect(settleMutate).toHaveBeenCalledWith({ refundId: "s1", paid: false });
  });

  it("a retry that errors is shown, not swallowed, and only under the row it was for", () => {
    retryState = { data: null, isError: true };
    render(<OrderRefundsAdmin />);
    expect(screen.queryByText(/could not be sent back to the queue/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send back to queue" }));
    expect(screen.getByText(/could not be sent back to the queue/)).toBeTruthy();
  });
});
