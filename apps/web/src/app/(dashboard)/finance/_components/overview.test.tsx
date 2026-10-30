/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";

const mockDashboard = jest.fn();
const mockKpis = jest.fn();
const mockFunding = jest.fn();
const mockFlags = jest.fn();

jest.mock("@/lib/finance/queries", () => ({
  useFinanceDashboard: () => mockDashboard(),
  useKpiSummary: () => mockKpis(),
  useRevenueByFundingSource: () => mockFunding(),
  useRiskFlags: () => mockFlags(),
}));

import { FinanceOverview } from "./overview";

const ok = <T,>(data: T) => ({ data, isLoading: false, isError: false });
const loading = { data: undefined, isLoading: true, isError: false };
const failed = { data: undefined, isLoading: false, isError: true };

const DASHBOARD = {
  cash_ngn: 150000,
  deferred_revenue_ngn: 20000,
  care_voucher_liability_ngn: 5000,
  receivables_ngn: 7000,
  vat_payable_ngn: 1000,
  wht_payable_ngn: 500,
  revenue_ytd_ngn: 900000,
  revenue_mtd_ngn: 100000,
  expenses_ytd_ngn: 300000,
  unreconciled: { count: 3, by_currency: [] },
  revenue_by_currency: [{ currency: "NGN", recognised_minor: 900000 }],
  open_period: "2026-10",
  entries_count: 12,
};
const KPIS = {
  currency: "NGN",
  revenue_mtd_minor: 1,
  gross_profit_mtd_minor: 1,
  gross_margin_pct: 60,
  net_income_mtd_minor: 1,
  net_margin_pct: 20,
  mom_revenue_growth_pct: 3.2,
  yoy_revenue_growth_pct: -1,
  dso_days: 12,
  cash_runway_months: 4,
  cash_minor: 1,
  receivable_minor: 1,
};
const FUNDING = {
  currency: "NGN",
  period_start: "a",
  period_end: "b",
  cash_minor: 80000,
  promotional_minor: 20000,
  unclassified_minor: 0,
  total_minor: 100000,
};
const NO_FLAGS = {
  pending_approvals_count: 0,
  aged_unreconciled_count: 0,
  reconciliation_flags_count: 0,
  fraud_signals_count: 0,
  ap_due_soon_count: 0,
  ap_overdue_count: 0,
  compliance_overdue_count: 0,
};

function setAll(parts: { d?: unknown; k?: unknown; f?: unknown; fl?: unknown }) {
  mockDashboard.mockReturnValue(parts.d ?? ok(DASHBOARD));
  mockKpis.mockReturnValue(parts.k ?? ok(KPIS));
  mockFunding.mockReturnValue(parts.f ?? ok(FUNDING));
  mockFlags.mockReturnValue(parts.fl ?? ok(NO_FLAGS));
}

describe("FinanceOverview", () => {
  it("shows real figures and says there are no flags when the flags were read", () => {
    setAll({});
    render(<FinanceOverview />);
    expect(screen.getByText("₦1,500")).toBeTruthy();
    expect(screen.getByText("No bookkeeping flags right now.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not draw ₦0 anywhere while everything is still loading", () => {
    setAll({ d: loading, k: loading, f: loading, fl: loading });
    const { container } = render(<FinanceOverview />);
    expect(container.textContent).not.toMatch(/₦0(?![\d,.])/);
    expect(screen.queryByText("No bookkeeping flags right now.")).toBeNull();
  });

  it("warns, and does not say there are no flags, when the risk flags failed", () => {
    setAll({ fl: failed });
    render(<FinanceOverview />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/health flags could not be loaded/);
    expect(alert.textContent).toMatch(/does not mean there are none/);
    expect(screen.queryByText("No bookkeeping flags right now.")).toBeNull();
  });

  it("shows a raised flag as a link", () => {
    setAll({ fl: ok({ ...NO_FLAGS, fraud_signals_count: 2 }) });
    render(<FinanceOverview />);
    expect(screen.getByText("2 fraud signals").closest("a")?.getAttribute("href")).toBe("/finance/fraud");
    expect(screen.queryByText("No bookkeeping flags right now.")).toBeNull();
  });

  it("leads with the most urgent flag under 'Needs you first' and lists the rest after it", () => {
    setAll({ fl: ok({ ...NO_FLAGS, pending_approvals_count: 5, fraud_signals_count: 1, ap_overdue_count: 2 }) });
    render(<FinanceOverview />);
    const section = screen.getByRole("region", { name: "Needs you first" });
    const links = Array.from(section.querySelectorAll("a")).map((a) => a.textContent);
    expect(links).toEqual(["1 fraud signal", "2 overdue bills", "5 pending approvals"]);
  });

  it("does not draw the 'Needs you first' list when the flags failed", () => {
    setAll({ fl: failed });
    render(<FinanceOverview />);
    expect(screen.queryByRole("region", { name: "Needs you first" })).toBeNull();
  });

  it("shows blank tiles and an alert, not zeros, when the ledger figures failed", () => {
    setAll({ d: failed });
    const { container } = render(<FinanceOverview />);
    expect(screen.getByRole("alert").textContent).toMatch(/ledger figures could not be loaded/);
    expect(container.textContent).not.toMatch(/₦0(?![\d,.])/);
    expect(screen.getAllByText("Could not be loaded").length).toBeGreaterThan(4);
  });

  it("does not show ₦0 cash collected when only the funding split failed", () => {
    setAll({ f: failed });
    const { container } = render(<FinanceOverview />);
    expect(screen.getByRole("alert").textContent).toMatch(/funding split could not be loaded/);
    expect(container.textContent).not.toMatch(/₦0(?![\d,.])/);
    expect(screen.getByText("₦1,500")).toBeTruthy();
  });

  it("keeps the figures and marks them out of date when a refresh failed", () => {
    setAll({ d: { data: DASHBOARD, isLoading: false, isError: true } });
    render(<FinanceOverview />);
    expect(screen.getByText("₦1,500")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/may be out of date/);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("separates no revenue booked yet from revenue not loaded", () => {
    setAll({ d: ok({ ...DASHBOARD, revenue_by_currency: [] }) });
    render(<FinanceOverview />);
    expect(screen.getByText("No revenue booked yet.")).toBeTruthy();
  });

  it("shows an alert in the key ratios section, not zeros, when the ratios failed", () => {
    setAll({ k: failed });
    render(<FinanceOverview />);
    expect(screen.getByRole("alert").textContent).toMatch(/Key ratios could not be loaded/);
    expect(screen.getByText("Gross margin")).toBeTruthy();
    expect(screen.queryByText("60%")).toBeNull();
  });

  it("names the section in a stale notice and mentions access", () => {
    setAll({ k: { data: KPIS, isLoading: false, isError: true } });
    render(<FinanceOverview />);
    const notice = screen.getByRole("status").textContent ?? "";
    expect(notice).toMatch(/The key ratios below may be out of date/);
    expect(notice).toMatch(/finance access has changed/);
    expect(screen.getByText("60%")).toBeTruthy();
  });

  it("says revenue could not be loaded, not 'No revenue booked yet', when the ledger failed", () => {
    setAll({ d: failed });
    render(<FinanceOverview />);
    expect(screen.queryByText("No revenue booked yet.")).toBeNull();
    // Walk up from the card's heading to the first ancestor that contains the
    // message. It must be the card itself, which is before the page-wide tiles.
    let node: HTMLElement | null = screen.getByText("Revenue by currency");
    while (node && !(node.textContent ?? "").includes("Could not be loaded")) node = node.parentElement;
    expect(node).not.toBeNull();
    expect(node?.textContent).not.toMatch(/Cash & clearing/);
  });
});
