/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import type { TransactionDetail, TransactionsPage } from "@/lib/finance/transactions";

const mockList = jest.fn();
const mockDetail = jest.fn();
const mockReplace = jest.fn();
let mockSearch = "period=this_month";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/finance/transactions",
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

jest.mock("@/lib/finance/transactions", () => {
  const actual = jest.requireActual("@/lib/finance/transactions");
  return { ...actual, useTransactions: () => mockList(), useTransactionDetail: () => mockDetail() };
});

import { TransactionDirectory } from "./transaction-directory";
import { TransactionDetailView } from "./transaction-detail";

const PAGE: TransactionsPage = {
  total: 2,
  total_payments_minor: 20150000,
  total_refunds_minor: 4000000,
  limit: 50,
  offset: 0,
  rows: [
    {
      event_id: "order:1",
      occurred_at: "2026-11-02T09:00:00Z",
      event_kind: "payment",
      stream: "membership",
      payer_type: "family_sponsor",
      provider: "paystack",
      amount_minor: 10000000,
      fee_minor: 0,
      currency: "NGN",
      reference: "REF0002",
      record_type: "order",
      record_id: "11111111-1111-1111-1111-111111111111",
      is_renewal: false,
      processing_error: false,
      settlement_status: "exception",
      refunded_minor: 4000000,
      payer_label: "Femi Adeyemi",
      beneficiary_label: "Halima Bello",
    },
    {
      event_id: "order_failed:2",
      occurred_at: "2026-11-03T09:00:00Z",
      event_kind: "failed_payment",
      stream: "membership",
      payer_type: "individual",
      provider: "paystack",
      amount_minor: 10000000,
      fee_minor: null,
      currency: "NGN",
      reference: "REF0003",
      record_type: "order",
      record_id: "22222222-2222-2222-2222-222222222222",
      is_renewal: false,
      processing_error: false,
      settlement_status: "not_applicable",
      refunded_minor: 0,
      payer_label: "Ngozi Eze",
      beneficiary_label: null,
    },
  ],
};

const ok = <T,>(data: T) => ({ data, isLoading: false, isError: false });

describe("TransactionDirectory", () => {
  beforeEach(() => {
    mockList.mockReset();
    mockReplace.mockReset();
    mockSearch = "period=this_month";
  });

  it("lists payer, beneficiary, status, settlement and what was refunded", () => {
    mockList.mockReturnValue(ok(PAGE));
    render(<TransactionDirectory />);
    expect(screen.getAllByText("Femi Adeyemi").length).toBeGreaterThan(0);
    expect(screen.getByText("Halima Bello")).toBeTruthy();
    expect(screen.getAllByText("Reconciliation exception").length).toBeGreaterThan(0);
    expect(screen.getByText("₦40,000 refunded")).toBeTruthy();
    expect(screen.getByText(/2/, { selector: "span.font-medium" })).toBeTruthy();
  });

  it("links each row to its transaction page", () => {
    mockList.mockReturnValue(ok(PAGE));
    const { container } = render(<TransactionDirectory />);
    expect(container.querySelector('a[href="/finance/transactions/order/11111111-1111-1111-1111-111111111111"]')).toBeTruthy();
  });

  it("puts a chosen filter in the URL and goes back to page one", () => {
    mockSearch = "period=this_month&page=3";
    mockList.mockReturnValue(ok(PAGE));
    render(<TransactionDirectory />);
    fireEvent.click(screen.getByRole("button", { name: "Family sponsors" }));
    const url = mockReplace.mock.calls[0][0] as string;
    expect(url).toContain("payer=family_sponsor");
    expect(url).toContain("period=this_month");
    expect(url).not.toContain("page=");
  });

  it("sorts by amount from the column header", () => {
    mockList.mockReturnValue(ok(PAGE));
    render(<TransactionDirectory />);
    fireEvent.click(screen.getByRole("button", { name: "Amount" }));
    expect(mockReplace.mock.calls[0][0]).toContain("sort=amount");
  });

  it("says a failed read is not the same as no transactions", () => {
    mockList.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<TransactionDirectory />);
    expect(screen.getByText(/This is not the same as there being none/)).toBeTruthy();
  });
});

const DETAIL: TransactionDetail = {
  event: { ...PAGE.rows[0], settlement_status: "exception" } as TransactionDetail["event"],
  payer: { label: "Femi Adeyemi", kind: "family_sponsor" },
  beneficiary: { label: "Halima Bello" },
  order: {
    state: "paid",
    list_amount_minor: 10000000,
    amount_minor: 10000000,
    fee_minor: 0,
    total_minor: 10000000,
    discount_minor: 0,
    sponsor_share_minor: 0,
    paid_at: "2026-11-02T09:00:00Z",
    created_at: "2026-11-02T08:58:00Z",
    item: "membership_annual",
    failure_reason: null,
  },
  membership: [{ id: "m1", tier: "evergreen", state: "active", source: "purchase", starts_at: "2026-11-02T09:00:00Z", ends_at: "2027-11-02T09:00:00Z", auto_renew: true, renewal_cancelled_at: null }],
  refunds: [{ id: "r1", amount_minor: 4000000, state: "completed", reason: "Duplicate charge", provider_reference: null, requested_at: "2026-11-04T09:00:00Z", decided_at: "2026-11-04T10:00:00Z", decided_by: "Ada Finance", completed_at: "2026-11-05T09:00:00Z", last_error_code: null }],
  refundable_minor: 6000000,
  webhooks: [{ event_type: "charge.success", status: "processed", received_at: "2026-11-02T09:00:01Z", processed_at: "2026-11-02T09:00:02Z", attempt_count: 1, last_error: null, signature_verified: true }],
  settlement: [],
  reconciliation: [{ kind: "break", type: "amount_mismatch", status: "open", provider_minor: 9900000, local_minor: 10000000, difference_minor: -100000, seen_at: "2026-11-03T09:00:00Z", closed_at: null, note: null }],
  ledger: [],
  timeline: [
    { at: "2026-11-02T09:00:00Z", label: "Payment confirmed", kind: "event" },
    { at: "2026-11-04T10:00:00Z", label: "Refund approved by Ada Finance", kind: "refund" },
  ],
};

describe("TransactionDetailView", () => {
  beforeEach(() => mockDetail.mockReset());

  it("shows the payment, payer and beneficiary apart, the refundable balance and the timeline", () => {
    mockDetail.mockReturnValue(ok(DETAIL));
    render(<TransactionDetailView recordType="order" recordId="11111111-1111-1111-1111-111111111111" />);
    expect(screen.getAllByText("₦100,000").length).toBeGreaterThan(0);
    expect(screen.getByText("Femi Adeyemi")).toBeTruthy();
    expect(screen.getByText("Halima Bello")).toBeTruthy();
    expect(screen.getByText(/gives the payer no access to that person/)).toBeTruthy();
    expect(screen.getByText("₦60,000")).toBeTruthy();
    expect(screen.getByText("Refund approved by Ada Finance")).toBeTruthy();
    expect(screen.getByText("amount mismatch")).toBeTruthy();
    expect(screen.getByText("Opening this record is logged in the finance audit log.")).toBeTruthy();
  });

  it("says when a record does not exist instead of showing an empty page", () => {
    mockDetail.mockReturnValue(ok(null));
    render(<TransactionDetailView recordType="order" recordId="11111111-1111-1111-1111-111111111111" />);
    expect(screen.getByText(/No transaction with this reference exists/)).toBeTruthy();
  });

  it("does not present a failed read as a missing record", () => {
    mockDetail.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<TransactionDetailView recordType="order" recordId="11111111-1111-1111-1111-111111111111" />);
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
    expect(screen.queryByText(/No transaction with this reference exists/)).toBeNull();
  });
});
