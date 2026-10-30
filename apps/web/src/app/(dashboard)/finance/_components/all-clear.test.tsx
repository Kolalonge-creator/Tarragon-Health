/** @jest-environment jsdom */
/**
 * A failed read must not print as the good-news line: "No open signals ✓", "No outstanding payables ✓",
 * "Everything captured is matched ✓", "Overdue 0" on the statutory filing calendar, "No finance
 * activity in this range" in the audit log. Each is a claim about the business.
 */
import { fireEvent, render, screen } from "@testing-library/react";

type Q = { data?: unknown; isLoading?: boolean; isError?: boolean };
const hooks: Record<string, Q> = {};
const auditArgs: unknown[] = [];

jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock("@/lib/finance/actions", () => new Proxy({ __esModule: true }, { get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : jest.fn(async () => ({ ok: true, data: {} }))) }));
jest.mock("@/lib/finance/queries", () => {
  const get = (name: string): Q => ({ data: undefined, isLoading: false, isError: false, ...hooks[name] });
  return {
    __esModule: true,
    financeKeys: { all: ["finance"] },
    fetchComplianceSuggestedAmount: jest.fn(),
    useFraudSignals: () => get("fraud"),
    useReconciliationSummary: () => get("recon"),
    useReconciliationFlags: () => get("flags"),
    useVendors: () => get("vendors"),
    useBills: () => get("bills"),
    useApAging: () => get("aging"),
    useFinanceAccounts: () => get("accounts"),
    useComplianceCalendar: () => get("calendar"),
    useFinanceAuditLog: (args: unknown) => { auditArgs.push(args); return get("auditLog"); },
    useFinanceAuditActions: () => get("auditActions"),
  };
});

import { FraudSignals } from "./fraud-signals";
import { Reconciliation } from "./reconciliation";
import { PayablesAndVendors } from "./payables";
import { ComplianceCalendar } from "./compliance";
import { FinanceAuditLog } from "./audit";

const ok = (data: unknown): Q => ({ data });
const failed: Q = { isError: true };
const stale = (data: unknown): Q => ({ data, isError: true });

beforeEach(() => {
  for (const k of Object.keys(hooks)) delete hooks[k];
  auditArgs.length = 0;
  hooks.accounts = ok([]);
});

function check(view: { container: HTMLElement }, claims: string[], expectAlertText: string) {
  expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toContain(expectAlertText);
  for (const claim of claims) expect(view.container.textContent).not.toContain(claim);
}

describe("fraud signals", () => {
  it("does not tick 'No open signals' when the read failed", () => {
    hooks.fraud = failed;
    check(render(<FraudSignals />), ["No open signals"], "Fraud signals could not be loaded");
  });
  it("keeps the last good list and says it may be old when only a refresh failed", () => {
    hooks.fraud = stale([]);
    render(<FraudSignals />);
    expect(screen.getByRole("status").textContent).toContain("may be out of date");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/No open signals/)).toBeTruthy();
  });
  it("ticks only for a read that worked", () => {
    hooks.fraud = ok([]);
    render(<FraudSignals />);
    expect(screen.getByText(/No open signals/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("reconciliation", () => {
  it("does not say everything matched when neither read worked", () => {
    hooks.recon = failed;
    hooks.flags = failed;
    check(render(<Reconciliation />), ["No open flags", "Everything captured is matched", "No settlements imported yet"], "Reconciliation flags could not be loaded");
    expect(screen.getAllByRole("alert").length).toBe(3);
  });
  it("fails each section on its own: a good flags read does not hide a failed settlements read", () => {
    hooks.recon = failed;
    hooks.flags = ok([]);
    const view = render(<Reconciliation />);
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toContain("Settlements could not be loaded");
    expect(view.container.textContent).toContain("No open flags");
  });
  it("shows the genuine all-clear lines when the reads worked", () => {
    hooks.recon = ok({ settlements: [], unmatched: [] });
    hooks.flags = ok([]);
    const view = render(<Reconciliation />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(view.container.textContent).toContain("Everything captured is matched");
    expect(view.container.textContent).toContain("No settlements imported yet");
  });
});

describe("payables", () => {
  it("does not say there are no vendors, bills or payables when the reads failed", () => {
    hooks.vendors = failed;
    hooks.bills = failed;
    hooks.aging = failed;
    const view = render(<PayablesAndVendors />);
    check(view, ["No vendors yet", "No bills yet", "No outstanding payables"], "Vendors could not be loaded");
    expect(screen.getAllByRole("alert").length).toBe(3);
  });
  it("shows the genuine empty lines when the reads worked", () => {
    hooks.vendors = ok([]);
    hooks.bills = ok([]);
    hooks.aging = ok([]);
    const view = render(<PayablesAndVendors />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(view.container.textContent).toContain("No outstanding payables");
  });
  it("says the aging list may be old when only a refresh failed, and keeps it", () => {
    hooks.vendors = ok([]);
    hooks.bills = ok([]);
    hooks.aging = stale([]);
    render(<PayablesAndVendors />);
    expect(screen.getByRole("status").textContent).toContain("Accounts payable aging may be out of date");
  });
});

describe("compliance calendar", () => {
  const rows = [
    { obligation_code: "paye", obligation_name: "PAYE", agency: "FIRS", period_label: "2026-09", due_date: "2026-10-10", status: "overdue", description: null, filed_at: null, remittance_reference: null, amount_minor: null },
    { obligation_code: "vat", obligation_name: "VAT", agency: "FIRS", period_label: "2026-10", due_date: "2026-11-21", status: "upcoming", description: null, filed_at: null, remittance_reference: null, amount_minor: null },
  ];
  it("shows no counts, not 0 overdue, and no 'Nothing configured', when the calendar failed", () => {
    hooks.calendar = failed;
    const view = render(<ComplianceCalendar />);
    check(view, ["Nothing configured"], "The filing calendar could not be loaded");
    expect(screen.getAllByText("Could not be loaded")).toHaveLength(3);
    expect(view.container.textContent).not.toMatch(/Overdue\s*0/);
  });
  it("shows the real counts when the calendar loaded", () => {
    hooks.calendar = ok(rows);
    const view = render(<ComplianceCalendar />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(view.container.textContent).toMatch(/Overdue\s*1/);
    expect(view.container.textContent).toMatch(/Upcoming\s*1/);
  });
  it("shows a real zero for a calendar that loaded and has nothing overdue", () => {
    hooks.calendar = ok([rows[1]]);
    const view = render(<ComplianceCalendar />);
    expect(view.container.textContent).toMatch(/Overdue\s*0/);
  });
  it("keeps the last good counts and says they may be old when only a refresh failed", () => {
    hooks.calendar = stale(rows);
    const view = render(<ComplianceCalendar />);
    expect(screen.getByRole("status").textContent).toContain("may be out of date");
    expect(view.container.textContent).toMatch(/Overdue\s*1/);
  });
  it("shows Loading, not 0, while it is on its way", () => {
    hooks.calendar = { isLoading: true };
    render(<ComplianceCalendar />);
    expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
  });
});

describe("audit log", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-31T10:00:00.000Z"));
  });
  afterEach(() => jest.useRealTimers());

  it("does not say nothing happened when the log could not be read", () => {
    hooks.auditLog = failed;
    hooks.auditActions = ok([]);
    check(render(<FinanceAuditLog />), ["No finance activity in this range"], "The activity log could not be loaded");
  });
  it("says so when the action filter list could not be loaded", () => {
    hooks.auditLog = ok([]);
    hooks.auditActions = failed;
    render(<FinanceAuditLog />);
    expect(screen.getByText("The action list could not be loaded.")).toBeTruthy();
  });
  it("shows the genuine empty line when the log was read", () => {
    hooks.auditLog = ok([]);
    hooks.auditActions = ok([]);
    render(<FinanceAuditLog />);
    expect(screen.getByText("No finance activity in this range.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("queries from the start of a Lagos day to the end of today in Lagos, with a stable key", () => {
    hooks.auditLog = ok([]);
    hooks.auditActions = ok([]);
    const { rerender } = render(<FinanceAuditLog />);
    rerender(<FinanceAuditLog />);
    expect(auditArgs[0]).toEqual({ from: "2026-09-30T23:00:00.000Z", to: "2026-10-31T22:59:59.999Z", action: undefined });
    expect(auditArgs[1]).toEqual(auditArgs[0]);
  });
  it("survives a cleared date input instead of throwing, and keeps the last good start date", () => {
    hooks.auditLog = ok([]);
    hooks.auditActions = ok([]);
    const { container } = render(<FinanceAuditLog />);
    const date = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(() => fireEvent.change(date, { target: { value: "" } })).not.toThrow();
    expect(date.value).toBe("2026-10-01");
    fireEvent.change(date, { target: { value: "2026-10-15" } });
    expect(auditArgs.at(-1)).toMatchObject({ from: "2026-10-14T23:00:00.000Z" });
  });
});
