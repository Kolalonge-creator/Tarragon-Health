/** @jest-environment jsdom */
/**
 * The three printed packs are handed to an auditor, a tax adviser or an investor. A source that did not
 * load must never print as an empty section ("No logged finance activity"), a zero (₦0.00 VAT) or a
 * field that is "not on file". It blocks the pack, or marks it as possibly out of date.
 */
import { render, screen } from "@testing-library/react";

type Q = { data?: unknown; isLoading?: boolean; isError?: boolean };
const hooks: Record<string, Q> = {};
const auditLogArgs: unknown[] = [];

jest.mock("next/image", () => ({ __esModule: true, default: () => null }));
jest.mock("next/link", () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
// The real ceilings are 50,000 rows, which jsdom cannot draw. Small ceilings test the same rule.
jest.mock("@/lib/finance/row-limits", () => ({
  ...jest.requireActual("@/lib/finance/row-limits"),
  PACK_LEDGER_LIMIT: 30,
  PACK_AUDIT_LOG_LIMIT: 20,
}));
jest.mock("@/lib/finance/queries", () => {
  const get = (name: string): Q => ({ data: undefined, isLoading: false, isError: false, ...hooks[name] });
  return {
    useCompanyProfile: () => get("profile"),
    useKpiSummary: () => get("kpi"),
    useIncomeStatement: () => get("pnl"),
    useBalanceSheet: () => get("bs"),
    useCashFlowStatement: () => get("cf"),
    useTrialBalance: () => get("tb"),
    useAllLedgerEntries: () => get("gl"),
    useReconciliationSummary: () => get("recon"),
    useApAging: () => get("aging"),
    useBudgetVariance: () => get("variance"),
    useApprovalHistory: () => get("approvals"),
    useAllFinanceAuditLog: (args: unknown) => { auditLogArgs.push(args); return get("auditLog"); },
    useTaxSummary: () => get("tax"),
    useComplianceCalendarForYear: () => get("calendar"),
  };
});

import { InvestorPack } from "./investor-pack";
import { AuditPack } from "./audit-pack";
import { GovernmentFilingsPack } from "./government-filings-pack";

const ok = (data: unknown): Q => ({ data });
const failedRead: Q = { isError: true };
const loadingRead: Q = { isLoading: true };

const PROFILE = { legal_name: "Tarragon Health Ltd", rc_number: "RC123", tin: "TIN456", vat_registration_number: null, registered_address: null };
const PNL = { net_revenue_minor: 5000000, expense_minor: 2000000, net_income_minor: 3000000, lines: [] };
const TAX = { output_vat_minor: 700000, input_vat_minor: 200000, wht_payable_minor: 50000, revenue_by_vat_treatment: [] };
const KPI = { revenue_mtd_minor: 100, gross_margin_pct: null, net_margin_pct: null, mom_revenue_growth_pct: null, yoy_revenue_growth_pct: null, dso_days: null, cash_runway_months: null, cash_minor: 100, receivable_minor: 100 };
const BS = { assets_minor: 1, liabilities_minor: 1, total_equity_minor: 0, accounts: [] };
const CF = { operating: { net_cash_from_operating_minor: 1 }, investing: { net_cash_from_investing_minor: 1 }, financing: { net_cash_from_financing_minor: 1 }, net_change_in_cash_minor: 1, cash_ending_minor: 1 };

function setAuditHealthy() {
  hooks.profile = ok(PROFILE);
  hooks.tb = ok([]);
  hooks.gl = ok([]);
  hooks.recon = ok({ settlements: [], unmatched: [] });
  hooks.aging = ok([]);
  hooks.variance = ok([]);
  hooks.approvals = ok([]);
  hooks.auditLog = ok([]);
}

beforeEach(() => {
  for (const k of Object.keys(hooks)) delete hooks[k];
  auditLogArgs.length = 0;
});

const printButton = () => screen.getByRole("button", { name: /print|not ready/i }) as HTMLButtonElement;

describe("audit pack", () => {
  const props = { from: "2026-10-01", to: "2026-10-31", currency: "NGN" };

  it("says what an empty section genuinely is, when every source loaded", () => {
    setAuditHealthy();
    render(<AuditPack {...props} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("No logged finance activity in this range.")).toBeTruthy();
    expect(printButton().disabled).toBe(false);
  });

  it.each([
    ["tb", "trial balance"],
    ["gl", "general ledger"],
    ["recon", "settlement reconciliation"],
    ["aging", "accounts payable aging"],
    ["variance", "budget variance"],
    ["approvals", "approval history"],
    ["auditLog", "finance audit trail"],
  ])("blocks the pack, naming the source, when %s did not load", (key, label) => {
    setAuditHealthy();
    hooks[key] = failedRead;
    const { container } = render(<AuditPack {...props} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Data unavailable: do not distribute");
    expect(container.textContent).toContain(label);
    for (const claim of ["No logged finance activity", "No entries in this range", "Nothing outstanding", "No ledger activity", "No settlements recorded", "unmatched payment event"]) {
      expect(container.textContent).not.toContain(claim);
    }
    expect(printButton().disabled).toBe(true);
  });

  it("keeps real data, and says it may be out of date, when only a refresh failed", () => {
    setAuditHealthy();
    hooks.auditLog = { data: [], isError: true };
    render(<AuditPack {...props} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("finance audit trail could not be refreshed");
    expect(printButton().disabled).toBe(false);
  });

  it("holds Print back while a source is still loading, so Loading is never printed", () => {
    setAuditHealthy();
    hooks.gl = loadingRead;
    render(<AuditPack {...props} />);
    expect(printButton().disabled).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("queries the audit trail for the Lagos days, not UTC days", () => {
    setAuditHealthy();
    render(<AuditPack {...props} />);
    expect(auditLogArgs[0]).toEqual({ from: "2026-09-30T23:00:00.000Z", to: "2026-10-31T22:59:59.999Z" });
  });

  it("counts an approval at 00:30 Lagos on the first day, and one at the last millisecond of the last day, and not one before", () => {
    setAuditHealthy();
    const mk = (id: string, at: string) => ({ id, requested_at: at, request_type: "manual_journal", requested_by_name: "Ada", status: "approved", reviewed_by_name: "Bola" });
    hooks.approvals = ok([
      mk("a", "2026-09-30T23:30:00Z"), // 00:30 on 1 October in Lagos
      mk("b", "2026-10-31T22:59:59.999Z"), // last millisecond of 31 October in Lagos
      mk("c", "2026-09-30T22:59:59Z"), // 23:59:59 on 30 September in Lagos
      mk("d", "2026-10-31T23:00:00Z"), // 00:00 on 1 November in Lagos
    ]);
    render(<AuditPack {...props} />);
    expect(screen.getAllByText("manual journal")).toHaveLength(2);
  });

  it("prints a warning in each section that reached its ceiling, because the pack calls itself the full record", () => {
    setAuditHealthy();
    const many = (n: number, make: (i: number) => unknown) => Array.from({ length: n }, (_, i) => make(i));
    hooks.gl = ok(many(30, (i) => ({ id: `g${i}`, entry_no: i, entry_date: "2026-10-01", source: "manual", memo: null, is_reversed: false, currency: "NGN", lines: [] })));
    hooks.auditLog = ok(many(20, (i) => ({ id: `l${i}`, created_at: "2026-10-01T10:00:00Z", actor_name: "Ada", action: "finance.post" })));
    hooks.approvals = ok(many(1000, (i) => ({ id: `a${i}`, requested_at: "2026-10-05T10:00:00Z", request_type: "manual_journal", requested_by_name: "Ada", status: "approved", reviewed_by_name: "Bola" })));
    render(<AuditPack {...props} />);
    const warnings = screen.getAllByText(/Incomplete: this section holds only the newest/).map((w) => w.textContent);
    expect(warnings).toHaveLength(3);
    expect(warnings.join(" ")).toContain("30 entries");
    expect(warnings.join(" ")).toContain("20 log rows");
    expect(warnings.join(" ")).toContain("1000 reviewed approvals");
  });

  it("prints no truncation warning for a short list", () => {
    setAuditHealthy();
    render(<AuditPack {...props} />);
    expect(screen.queryByText(/Incomplete: this section/)).toBeNull();
  });

  it("says the company details could not be loaded when only the letterhead profile failed", () => {
    setAuditHealthy();
    hooks.profile = failedRead;
    render(<AuditPack {...props} />);
    expect(screen.getByText(/Company details could not be loaded/)).toBeTruthy();
  });
});

describe("government filings pack", () => {
  const healthy = () => {
    hooks.profile = ok(PROFILE);
    hooks.pnl = ok(PNL);
    hooks.tax = ok(TAX);
    hooks.calendar = ok([]);
  };

  it("prints real figures and the genuine empty calendar message when every source loaded", () => {
    healthy();
    const { container } = render(<GovernmentFilingsPack year={2026} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.textContent).toContain("Nothing configured.");
    expect(container.textContent).toContain("Net VAT payable₦5,000");
    expect(container.textContent).toContain("WHT payable₦500");
    expect(printButton().disabled).toBe(false);
  });

  it.each([
    ["profile", "company profile"],
    ["pnl", "income statement"],
    ["tax", "tax summary"],
    ["calendar", "compliance calendar"],
  ])("blocks the pack, with no zeros and no 'not on file', when %s did not load", (key, label) => {
    healthy();
    hooks[key] = failedRead;
    const { container } = render(<GovernmentFilingsPack year={2026} />);
    expect(screen.getByRole("alert").textContent).toContain("Data unavailable: do not distribute");
    expect(container.textContent).toContain(label);
    for (const claim of ["not on file", "Nothing configured", "Net VAT payable"]) {
      expect(container.textContent).not.toContain(claim);
    }
    expect(container.textContent).not.toMatch(/₦0(\.00)?(?![\d,])/);
    expect(printButton().disabled).toBe(true);
  });

  it("does not print 'not on file' for every particular while the profile is still loading", () => {
    healthy();
    hooks.profile = loadingRead;
    const { container } = render(<GovernmentFilingsPack year={2026} />);
    expect(container.textContent).not.toContain("not on file");
    expect(printButton().disabled).toBe(true);
  });

  it("still says 'not on file' for a field the loaded profile genuinely lacks", () => {
    healthy();
    render(<GovernmentFilingsPack year={2026} />);
    expect(screen.getAllByText("not on file").length).toBeGreaterThan(0);
  });
});

describe("investor pack (unchanged behaviour, now on the shared helper)", () => {
  const props = { from: "2026-01-01", to: "2026-10-31", currency: "NGN" };
  const healthy = () => {
    hooks.profile = ok(PROFILE);
    hooks.kpi = ok(KPI);
    hooks.pnl = ok(PNL);
    hooks.bs = ok(BS);
    hooks.cf = ok(CF);
    hooks.tb = ok([]);
  };

  it("blocks the pack when a source never loaded", () => {
    healthy();
    hooks.cf = failedRead;
    const { container } = render(<InvestorPack {...props} />);
    expect(screen.getByRole("alert").textContent).toContain("Data unavailable: do not distribute");
    expect(container.textContent).toContain("cash flow statement");
    expect(printButton().disabled).toBe(true);
  });

  it("keeps real data and says so when only a refresh failed", () => {
    healthy();
    hooks.kpi = { data: KPI, isError: true };
    render(<InvestorPack {...props} />);
    expect(screen.getByRole("status").textContent).toContain("key metrics could not be refreshed");
  });

  it("is quiet and printable when everything loaded", () => {
    healthy();
    render(<InvestorPack {...props} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(printButton().disabled).toBe(false);
  });
});
