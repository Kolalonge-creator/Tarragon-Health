/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import type { MoneyOverview } from "@/lib/finance/money-overview";

const mockQuery = jest.fn();
const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/finance",
  useSearchParams: () => new URLSearchParams("period=this_month&compare=previous_period"),
}));

// Recharts needs a measured container; jsdom has none, so the chart shell is stubbed. The figures under test are text.
jest.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children }: { children: unknown }) => <div data-testid="chart">{children as never}</div>,
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
}));

jest.mock("@/lib/finance/money-overview", () => {
  const actual = jest.requireActual("@/lib/finance/money-overview");
  return { ...actual, useMoneyOverview: () => mockQuery() };
});

import { MoneyOverviewSection } from "./money-overview";

const totals = {
  from: "2026-11-01",
  to: "2026-11-07",
  gross_payment_volume_minor: 31650000,
  successful_payments: 4,
  refunds_minor: 3000000,
  refund_count: 1,
  net_collections_minor: 28650000,
  failed_payments: 1,
  success_rate: 0.8,
  customer_fees_minor: 150000,
  processing_errors: 1,
  recognised_revenue_minor: 400000,
};

const DATA: MoneyOverview = {
  currency: "NGN",
  granularity: "day",
  generated_at: "2026-11-07T10:00:00Z",
  current: totals,
  previous: { ...totals, gross_payment_volume_minor: 5000000 },
  active_paid_memberships: 3,
  active_paid_memberships_previous: 1,
  open_reconciliation_items: 2,
  series: [
    { bucket: "2026-11-01", gross_minor: 10150000, refunds_minor: 0, net_minor: 10150000, recognised_minor: 400000, successful_payments: 1, failed_payments: 0 },
    { bucket: "2026-11-02", gross_minor: 21500000, refunds_minor: 3000000, net_minor: 18500000, recognised_minor: 0, successful_payments: 3, failed_payments: 1 },
  ],
  composition: [
    { payer_type: "individual", amount_minor: 12650000, count: 2, previous_amount_minor: 5000000 },
    { payer_type: "family_sponsor", amount_minor: 10000000, count: 1, previous_amount_minor: 0 },
    { payer_type: "employer", amount_minor: 9000000, count: 1, previous_amount_minor: 0 },
  ],
  streams: [{ stream: "membership", amount_minor: 20150000, count: 2, refunds_minor: 3000000 }],
  providers: [{ provider: "paystack", successful: 3, successful_minor: 22650000, failed: 1, refunds_minor: 3000000, processing_errors: 1, success_rate: 0.75 }],
  recent: [
    {
      event_id: "order:1",
      occurred_at: "2026-11-02T09:00:00Z",
      event_kind: "payment",
      stream: "membership",
      payer_type: "family_sponsor",
      provider: "paystack",
      amount_minor: 10000000,
      currency: "NGN",
      reference: "REF0002",
      record_type: "order",
      record_id: "1",
      is_renewal: false,
      processing_error: false,
      payer_label: "Ngozi Eze",
    },
  ],
};

const ok = { data: DATA, isLoading: false, isError: false, isFetching: false, refetch: jest.fn() };

describe("MoneyOverviewSection", () => {
  beforeEach(() => mockQuery.mockReset());

  it("shows the four money measures as separate, defined figures", () => {
    mockQuery.mockReturnValue(ok);
    render(<MoneyOverviewSection />);
    expect(screen.getByText("Gross payment volume")).toBeTruthy();
    expect(screen.getByText("₦316,500")).toBeTruthy();
    expect(screen.getByText("Net collections")).toBeTruthy();
    expect(screen.getByText("₦286,500")).toBeTruthy();
    expect(screen.getByText("Recognised revenue")).toBeTruthy();
    expect(screen.getByText("₦4,000")).toBeTruthy();
    expect(screen.getByLabelText("What Gross payment volume means").getAttribute("href")).toBe("/finance/glossary#gross_payment_volume");
  });

  it("splits payers into member, family sponsor and employer", () => {
    mockQuery.mockReturnValue(ok);
    render(<MoneyOverviewSection />);
    expect(screen.getByText("Paid by the member")).toBeTruthy();
    expect(screen.getByText("Family sponsors")).toBeTruthy();
    expect(screen.getByText("Employers")).toBeTruthy();
  });

  it("flags a payment taken but not applied", () => {
    mockQuery.mockReturnValue(ok);
    render(<MoneyOverviewSection />);
    expect(screen.getByText(/taken by the provider but not\s+applied by our system/)).toBeTruthy();
  });

  it("shows the activity feed without any health information", () => {
    mockQuery.mockReturnValue(ok);
    const { container } = render(<MoneyOverviewSection />);
    expect(screen.getByText(/Membership · Ngozi Eze/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/diagnos|result|medication|blood pressure/i);
  });

  it("shows nothing, not zeros, when the figures fail to load", () => {
    mockQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true, isFetching: false, refetch: jest.fn() });
    render(<MoneyOverviewSection />);
    expect(screen.getByText(/could not be loaded, so nothing is shown rather than zeros/)).toBeTruthy();
    expect(screen.queryByText("₦0")).toBeNull();
  });

  it("keeps the last figures with a warning when a refresh fails", () => {
    mockQuery.mockReturnValue({ ...ok, isError: true });
    render(<MoneyOverviewSection />);
    expect(screen.getByText(/may be out of date/)).toBeTruthy();
    expect(screen.getByText("₦316,500")).toBeTruthy();
  });

  it("says plainly when a period had no money movement", () => {
    const quiet = {
      ...DATA,
      current: { ...totals, gross_payment_volume_minor: 0, net_collections_minor: 0, successful_payments: 0, refund_count: 0, refunds_minor: 0, failed_payments: 0, success_rate: null, recognised_revenue_minor: 0, processing_errors: 0 },
      composition: DATA.composition.map((c) => ({ ...c, amount_minor: 0, count: 0 })),
      providers: [],
    };
    mockQuery.mockReturnValue({ ...ok, data: quiet });
    render(<MoneyOverviewSection />);
    expect(screen.getByText("No payments, refunds or recognised revenue in this period.")).toBeTruthy();
    expect(screen.getAllByText("No attempts").length).toBeGreaterThan(0);
  });
});
