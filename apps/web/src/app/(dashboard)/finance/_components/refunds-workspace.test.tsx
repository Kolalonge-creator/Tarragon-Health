/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import type { QueuedRefund, RefundQueue } from "@/lib/finance/refunds";

const mockQueue = jest.fn();
const mockSettings = jest.fn();
const mockMutate = jest.fn();
const mockSetThreshold = jest.fn();

jest.mock("@/lib/finance/refunds", () => {
  const actual = jest.requireActual("@/lib/finance/refunds");
  return {
    ...actual,
    useRefundQueue: () => mockQueue(),
    useRefundSettings: () => mockSettings(),
    useDecideRefund: () => ({ mutate: mockMutate, isPending: false }),
    useSetRefundThreshold: () => ({ mutate: mockSetThreshold, isPending: false, isError: false }),
  };
});

import { RefundsWorkspace } from "./refunds-workspace";
import { decisionAvailability, decisionMessage, refundTab } from "@/lib/finance/refunds";

const refund = (over: Partial<QueuedRefund> = {}): QueuedRefund => ({
  id: "r1",
  order_id: "o1",
  amount_minor: 10000000,
  state: "pending",
  reason: "Charged twice",
  requested_at: "2026-11-05T09:00:00Z",
  requested_by: "Ngozi Eze",
  requested_by_staff: false,
  requested_by_me: false,
  needs_second_approval: false,
  first_approved_by: null,
  first_approved_by_me: false,
  first_approved_at: null,
  first_approval_note: null,
  decided_by: null,
  decided_at: null,
  decision_note: null,
  completed_at: null,
  attempts: 0,
  last_error_code: null,
  provider_status: null,
  payer: "Ngozi Eze",
  beneficiary: null,
  item: "membership_annual",
  paystack_reference: "REF1",
  order_paid_at: "2026-11-01T09:00:00Z",
  order_price_minor: 10000000,
  ...over,
});

const queue = (refunds: QueuedRefund[], over: Partial<RefundQueue> = {}): RefundQueue => ({
  caller_id: "me",
  can_decide: true,
  second_approval_threshold_minor: 5000000,
  refunds,
  ...over,
});

const ok = <T,>(data: T) => ({ data, isLoading: false, isError: false });

describe("refund decision rules (UI side; the database enforces the same)", () => {
  it("lets a decider approve or reject a pending refund", () => {
    expect(decisionAvailability(refund(), true)).toEqual({ approve: true, reject: true, why: null });
  });
  it("blocks a view-only user, explaining why", () => {
    expect(decisionAvailability(refund(), false)).toMatchObject({ approve: false, reject: false, why: expect.stringContaining("permission") });
  });
  it("blocks deciding your own request", () => {
    expect(decisionAvailability(refund({ requested_by_me: true }), true)).toMatchObject({ approve: false, reject: false });
  });
  it("lets the first approver reject but not approve again", () => {
    expect(decisionAvailability(refund({ needs_second_approval: true, first_approved_by: "Me", first_approved_by_me: true }), true)).toMatchObject({
      approve: false,
      reject: true,
    });
  });
  it("offers nothing on a refund that is no longer pending", () => {
    expect(decisionAvailability(refund({ state: "approved" }), true)).toEqual({ approve: false, reject: false, why: null });
  });
  it("sorts refunds into tabs", () => {
    expect(refundTab(refund())).toBe("decide");
    expect(refundTab(refund({ state: "processing" }))).toBe("in_progress");
    expect(refundTab(refund({ state: "failed" }))).toBe("failed");
    expect(refundTab(refund({ state: "completed" }))).toBe("finished");
  });
  it("only claims the Membership ended when the database says it did", () => {
    expect(decisionMessage({ result: "approved", membership_ended: false, entitlement_revoked: false }).text).not.toMatch(/ended/);
    expect(decisionMessage({ result: "approved", membership_ended: true }).text).toMatch(/has ended/);
  });
  it("explains every database answer, never pretending a hold is an approval", () => {
    expect(decisionMessage({ result: "awaiting_second_approval" })).toMatchObject({ tone: "info", text: expect.stringContaining("second") });
    expect(decisionMessage({ result: "same_approver" }).tone).toBe("refusal");
    expect(decisionMessage({ result: "own_request" }).tone).toBe("refusal");
    expect(decisionMessage({ result: "something_new" })).toMatchObject({ tone: "refusal", text: expect.stringContaining("something_new") });
  });
});

// jsdom has no <dialog> methods; ConfirmDialog uses them.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});

describe("RefundsWorkspace", () => {
  beforeEach(() => {
    mockQueue.mockReset();
    mockSettings.mockReset();
    mockMutate.mockReset();
    mockSettings.mockReturnValue(ok({ currency: "NGN", second_approval_threshold_minor: 5000000, updated_at: null, updated_by: null }));
  });

  it("shows the threshold and labels a large refund as needing two approvals", () => {
    mockQueue.mockReturnValue(ok(queue([refund({ needs_second_approval: true })])));
    render(<RefundsWorkspace />);
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
    expect(screen.getByText("₦50,000")).toBeTruthy();
    expect(screen.getByText("Needs 2 approvals")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Give first approval" })).toBeTruthy();
  });

  it("says one approval is enough when no threshold is set", () => {
    mockSettings.mockReturnValue(ok({ currency: "NGN", second_approval_threshold_minor: null, updated_at: null, updated_by: null }));
    mockQueue.mockReturnValue(ok(queue([refund()], { second_approval_threshold_minor: null })));
    render(<RefundsWorkspace />);
    expect(screen.getByText(/one approval is enough for every refund/)).toBeTruthy();
  });

  it("will not send a rejection without a 5-character reason", () => {
    mockQueue.mockReturnValue(ok(queue([refund()])));
    render(<RefundsWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const confirm = screen.getAllByRole("button", { name: "Reject" }).at(-1) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Not eligible" } });
    expect((screen.getAllByRole("button", { name: "Reject" }).at(-1) as HTMLButtonElement).disabled).toBe(false);
  });

  it("approves only through the confirmation, sending the refund id", () => {
    mockQueue.mockReturnValue(ok(queue([refund()])));
    render(<RefundsWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(mockMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Approve" }).at(-1) as HTMLElement);
    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({ refundId: "r1", approve: true }), expect.anything());
  });

  it("lets an admin change the threshold", () => {
    mockQueue.mockReturnValue(ok(queue([])));
    render(<RefundsWorkspace canEditThreshold />);
    expect(screen.getByRole("button", { name: "Change" })).toBeTruthy();
  });

  it("disables decisions for a view-only user, says why, and hides the member's reason", () => {
    mockQueue.mockReturnValue(ok(queue([refund({ reason: null })], { can_decide: false })));
    render(<RefundsWorkspace />);
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText(/can see refunds but not decide them/).length).toBeGreaterThan(0);
    expect(screen.getByText(/shown to refund approvers only/)).toBeTruthy();
  });

  it("does not show a failed read as an empty queue", () => {
    mockQueue.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<RefundsWorkspace />);
    expect(screen.getByText(/not the same as there being none/)).toBeTruthy();
    expect(screen.queryByText("Nothing here.")).toBeNull();
  });
});
