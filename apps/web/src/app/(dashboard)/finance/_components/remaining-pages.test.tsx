/** @jest-environment jsdom */
/**
 * The rest of the finance console: a failed read must not print as an empty list or a zero, a list that
 * reached its row limit must say it may be cut off, and a statutory figure must not flash as zero while
 * it loads.
 */
import { fireEvent, render, screen } from "@testing-library/react";

type Q = { data?: unknown; isLoading?: boolean; isError?: boolean };
const hooks: Record<string, Q> = {};
const ledgerArgs: unknown[] = [];
const unifiedArgs: unknown[] = [];
const actions: Record<string, jest.Mock> = {};
const act = (name: string) => (actions[name] ??= jest.fn(async () => ({ ok: true, data: {} })));

jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock("next/link", () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
jest.mock("@/lib/finance/actions", () => new Proxy({ __esModule: true }, { get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : (...a: unknown[]) => act(k)(...a)) }));
jest.mock("@/lib/finance/queries", () => {
  const get = (name: string): Q => ({ data: undefined, isLoading: false, isError: false, ...hooks[name] });
  return {
    __esModule: true,
    financeKeys: { all: ["finance"] },
    fetchComplianceSuggestedAmount: jest.fn(),
    useLedgerEntries: (args: unknown) => { ledgerArgs.push(args); return get("entries"); },
    useFinanceAccounts: () => get("accounts"),
    useCostCenters: () => get("costCenters"),
    useBudgetVariance: () => get("variance"),
    useBudgets: () => get("budgets"),
    useRevrecSummary: () => get("revrec"),
    useEmployerBillingSummary: () => get("billing"),
    useFinancePeriods: () => get("periods"),
    useApprovalSettings: () => get("approvalSettings"),
    useTaxSummary: () => get("tax"),
    useTaxRates: () => get("rates"),
    useUnifiedLedger: (args: unknown) => { unifiedArgs.push(args); return get("unified"); },
    useCompanyProfile: () => get("profile"),
    useVendors: () => get("vendors"),
    useBills: () => get("bills"),
    useApAging: () => get("aging"),
  };
});

import { LedgerBrowser } from "./ledger";
import { Budgets } from "./budgets";
import { RevenueRecognition } from "./revenue";
import { EmployerBilling } from "./employer-billing";
import { FinanceSettings } from "./settings";
import { TaxConsole } from "./tax";
import { UnifiedLedgerLookup } from "./unified-ledger";
import { PayablesAndVendors } from "./payables";
import { ReportsHub } from "../reports/_components/reports-hub";

const ok = (data: unknown): Q => ({ data });
const failed: Q = { isError: true };
const stale = (data: unknown): Q => ({ data, isError: true });
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const alerts = () => screen.getAllByRole("alert").map((a) => a.textContent).join(" | ");

beforeEach(() => {
  for (const k of Object.keys(hooks)) delete hooks[k];
  for (const k of Object.keys(actions)) delete actions[k];
  ledgerArgs.length = 0;
  unifiedArgs.length = 0;
  hooks.accounts = ok([]);
  hooks.costCenters = ok([]);
});

const rowsOf = (n: number, make: (i: number) => unknown) => Array.from({ length: n }, (_, i) => make(i));

describe("general ledger", () => {
  it("does not say 'No entries in this range' when the read failed", () => {
    hooks.entries = failed;
    const { container } = render(<LedgerBrowser />);
    expect(alerts()).toContain("The general ledger could not be loaded");
    expect(container.textContent).not.toContain("No entries in this range");
  });
  it("says the list may be cut off when it is exactly as long as the row limit", () => {
    hooks.entries = ok(rowsOf(200, (i) => ({ id: `e${i}`, entry_no: i, entry_date: "2026-10-01", source: "manual", memo: null, is_reversed: false, currency: "NGN", lines: [] })));
    render(<LedgerBrowser />);
    expect(screen.getByRole("status").textContent).toContain("Showing the newest 200 entries");
  });
  it("says nothing about a limit for a shorter list, and the genuine empty line for an empty one", () => {
    hooks.entries = ok([]);
    render(<LedgerBrowser />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("No entries in this range.")).toBeTruthy();
  });
  it("tells the person when the chart of accounts could not be loaded, rather than an empty dropdown", () => {
    hooks.entries = ok([]);
    hooks.accounts = failed;
    render(<LedgerBrowser />);
    fireEvent.click(screen.getByText("New entry"));
    expect(alerts()).toContain("The chart of accounts could not be loaded");
  });
});

describe("budgets", () => {
  it("does not say there are no budgets when the reads failed", () => {
    hooks.variance = failed;
    hooks.budgets = failed;
    const { container } = render(<Budgets />);
    expect(alerts()).toContain("Budget vs actual could not be loaded");
    expect(alerts()).toContain("Budget lines could not be loaded");
    expect(container.textContent).not.toContain("No budgets or activity");
    expect(container.textContent).not.toContain("No budget lines configured yet");
  });
  it("says which currency a new budget line will be saved in", () => {
    hooks.variance = ok([]);
    hooks.budgets = ok([]);
    render(<Budgets />);
    fireEvent.click(screen.getByText("New budget line"));
    expect(screen.getByText(/will be saved in/).textContent).toContain("NGN");
  });
  it("tells the person when the accounts or cost centres could not be loaded", () => {
    hooks.variance = ok([]);
    hooks.budgets = ok([]);
    hooks.accounts = failed;
    hooks.costCenters = failed;
    render(<Budgets />);
    fireEvent.click(screen.getByText("New budget line"));
    expect(alerts()).toContain("The chart of accounts could not be loaded");
    expect(alerts()).toContain("The cost centres could not be loaded");
  });
});

describe("revenue recognition", () => {
  const summary = { total_deferred_minor: 5000000, total_recognized_minor: 1000000, active_schedules: 3, schedules: [] };
  it("shows no deferred or recognised figure, not ₦0, when the summary failed", () => {
    hooks.revrec = failed;
    const { container } = render(<RevenueRecognition />);
    expect(alerts()).toContain("Recognition schedules could not be loaded");
    expect(screen.getAllByText("Could not be loaded").length).toBe(3);
    expect(container.textContent).not.toMatch(/₦0(\.00)?(?![\d,])/);
    expect(container.textContent).not.toContain("No recognition schedules yet");
  });
  it("shows Loading, not ₦0, while on its way", () => {
    hooks.revrec = { isLoading: true };
    const { container } = render(<RevenueRecognition />);
    expect(container.textContent).not.toMatch(/₦0(\.00)?(?![\d,])/);
    expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
  });
  it("shows the real figures, and a real zero schedules line, when it loaded", () => {
    hooks.revrec = ok(summary);
    const { container } = render(<RevenueRecognition />);
    expect(container.textContent).toContain("₦50,000");
    expect(screen.getByText("No recognition schedules yet.")).toBeTruthy();
  });
  it("does not report a run that returned no count as '0 entries posted'", async () => {
    hooks.revrec = ok(summary);
    render(<RevenueRecognition />);
    fireEvent.click(screen.getByText("Run recognition now"));
    expect(await screen.findByText(/number of entries posted was not returned/)).toBeTruthy();
  });
});

describe("employer billing", () => {
  it("does not say there are no organisations when the read failed", () => {
    hooks.billing = failed;
    const { container } = render(<EmployerBilling />);
    expect(alerts()).toContain("Employer billing could not be loaded");
    expect(container.textContent).not.toContain("No corporate or HMO organisations yet");
  });
});

describe("settings", () => {
  it("does not say 'No periods yet' or hide the threshold, accounts and cost centres, when their reads failed", () => {
    hooks.periods = failed;
    hooks.accounts = failed;
    hooks.costCenters = failed;
    hooks.approvalSettings = failed;
    const { container } = render(<FinanceSettings />);
    for (const w of ["Accounting periods", "The chart of accounts", "The cost centres", "The approval threshold"]) {
      expect(alerts()).toContain(`${w} could not be loaded`);
    }
    expect(container.textContent).not.toContain("No periods yet");
  });
  it("only saves the approval threshold when the value actually changed", () => {
    hooks.periods = ok([]);
    hooks.accounts = ok([]);
    hooks.costCenters = ok([]);
    hooks.approvalSettings = ok([{ currency: "NGN", threshold_minor: 100000000 }]);
    const { container } = render(<FinanceSettings />);
    const input = container.querySelector('input[inputmode="decimal"]') as HTMLInputElement;
    fireEvent.blur(input); // tabbed through, unchanged
    expect(act("upsertApprovalThresholdAction")).not.toHaveBeenCalled();
    type(input, "2,000,000");
    fireEvent.blur(input);
    expect(act("upsertApprovalThresholdAction")).toHaveBeenCalledWith("NGN", 200000000);
  });
});

describe("tax", () => {
  it("shows Loading, not ₦0.00, on the statutory tiles while the summary is on its way", () => {
    hooks.tax = { isLoading: true };
    hooks.rates = ok([]);
    const { container } = render(<TaxConsole />);
    expect(container.textContent).not.toMatch(/₦0(\.00)?(?![\d,])/);
    expect(screen.getAllByText("Loading…").length).toBeGreaterThanOrEqual(4);
  });
  it("shows the real VAT figures when it loaded", () => {
    hooks.tax = ok({ from: "a", to: "b", currency: "NGN", output_vat_minor: 700000, input_vat_minor: 200000, wht_payable_minor: 50000, revenue_by_vat_treatment: [] });
    hooks.rates = ok([]);
    const { container } = render(<TaxConsole />);
    expect(container.textContent).toContain("₦5,000");
  });
});

describe("transactions lookup", () => {
  const submit = (container: HTMLElement) => {
    type(container.querySelector("input") as HTMLInputElement, "p-1");
    fireEvent.click(screen.getByText("Look up"));
  };
  it("says the read failed, not that the ID is wrong", () => {
    hooks.unified = failed;
    const { container } = render(<UnifiedLedgerLookup />);
    submit(container);
    expect(alerts()).toContain("could not be loaded");
    expect(container.textContent).not.toContain("Check the ID is correct");
  });
  it("says the list may be cut off at the limit, and lets the person ask for more", () => {
    hooks.unified = ok(rowsOf(50, (i) => ({ entry_id: `e${i}`, payment_transaction_id: `p${i}`, entry_date: "2026-10-01", posted_at: "2026-10-01T10:00:00Z", source: "payment", service_label: "x", payer_profile_id: null, payer_label: "a", recipient_label: "b", direction: "money_in", amount_minor: 100, currency: "NGN", status: "completed", method: null, memo: null })));
    const { container } = render(<UnifiedLedgerLookup />);
    submit(container);
    expect(screen.getByRole("status").textContent).toContain("Showing the newest 50 transactions");
    fireEvent.click(screen.getByText("Show up to 200"));
    expect(unifiedArgs.at(-1)).toMatchObject({ limit: 200 });
  });
  it("keeps the genuine 'No transactions found' for a read that worked", () => {
    hooks.unified = ok([]);
    const { container } = render(<UnifiedLedgerLookup />);
    submit(container);
    expect(screen.getByText("No transactions found for this patient.")).toBeTruthy();
  });
});

describe("reports hub", () => {
  it("warns when the company profile could not be read, instead of staying silent", () => {
    hooks.profile = failed;
    render(<ReportsHub />);
    expect(alerts()).toContain("company profile could not be loaded");
  });
  it("keeps the incomplete-profile warning for a profile that loaded without an RC number", () => {
    hooks.profile = ok({ legal_name: "Tarragon", rc_number: null, tin: null });
    render(<ReportsHub />);
    expect(screen.getByText(/isn't on file yet/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("payables", () => {
  it("tells the person when the chart of accounts could not be loaded, in the bill form", () => {
    hooks.vendors = ok([]);
    hooks.bills = ok([]);
    hooks.aging = ok([]);
    hooks.accounts = failed;
    render(<PayablesAndVendors />);
    fireEvent.click(screen.getByText("New bill"));
    expect(alerts()).toContain("The chart of accounts could not be loaded");
  });
});

// stale data keeps showing, with a notice, on a representative list
describe("stale data", () => {
  it("keeps the last good ledger and says it may be old", () => {
    hooks.entries = stale([]);
    render(<LedgerBrowser />);
    expect(screen.getByRole("status").textContent).toContain("may be out of date");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
