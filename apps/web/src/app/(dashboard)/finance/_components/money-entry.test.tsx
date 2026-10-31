/** @jest-environment jsdom */
/**
 * What a person types into a finance amount field must reach the save action as exactly
 * that amount, or be refused with a reason. majorToMinor used to read "1,500,000" as one naira
 * and "abc" as zero, so a comma truncated a journal line and an unreadable line was dropped.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const hooks: Record<string, unknown> = {};
const actions: Record<string, jest.Mock> = {};
const act = (name: string) => (actions[name] ??= jest.fn(async () => ({ ok: true, data: {} })));

jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock("@/lib/finance/queries", () => {
  const empty = { data: [], isLoading: false, isError: false };
  return new Proxy(
    { __esModule: true, financeKeys: { all: ["finance"] }, fetchComplianceSuggestedAmount: jest.fn(async () => ({})) },
    { get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : () => hooks[k] ?? empty) },
  );
});
jest.mock("@/lib/finance/actions", () =>
  new Proxy({ __esModule: true }, { get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : (...a: unknown[]) => act(k)(...a)) }),
);

import { LedgerBrowser } from "./ledger";
import { PayablesAndVendors } from "./payables";
import { Budgets } from "./budgets";
import { ComplianceCalendar } from "./compliance";
import { EmployerBilling } from "./employer-billing";
import { FinanceSettings } from "./settings";
import { Reconciliation } from "./reconciliation";

const ACCOUNTS = [
  { code: "1000", name: "Bank", type: "asset", normal_balance: "debit", is_active: true, sort_order: 1, description: null, vat_treatment: null },
  { code: "2000", name: "Accruals", type: "liability", normal_balance: "credit", is_active: true, sort_order: 2, description: null, vat_treatment: null },
  { code: "5000", name: "Rent", type: "expense", normal_balance: "debit", is_active: true, sort_order: 3, description: null, vat_treatment: null },
];
const q = (data: unknown) => ({ data, isLoading: false, isError: false });
const decimalInputs = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]'));
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

// jsdom does not implement the modal dialog methods the shared ConfirmDialog calls.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});

beforeEach(() => {
  for (const k of Object.keys(hooks)) delete hooks[k];
  for (const k of Object.keys(actions)) actions[k].mockClear();
  hooks.useFinanceAccounts = q(ACCOUNTS);
});

describe("manual journal", () => {
  function openAndPickAccounts() {
    const view = render(<LedgerBrowser />);
    fireEvent.click(screen.getByText("New entry"));
    const accountSelects = screen.getAllByDisplayValue("Select…");
    type(accountSelects[0], "1000");
    type(accountSelects[1], "2000");
    return view;
  }

  it("posts a comma-separated amount as the full amount, not one naira", async () => {
    const { container } = openAndPickAccounts();
    const [debit1, , , credit2] = decimalInputs(container);
    type(debit1, "1,500,000");
    type(credit2, "1,500,000");
    fireEvent.click(screen.getByText("Post entry"));
    fireEvent.click(within(container.querySelector("dialog[open]") as HTMLElement).getByRole("button", { name: "Post entry" }));
    await waitFor(() => expect(act("postManualJournalAction")).toHaveBeenCalledTimes(1));
    const arg = act("postManualJournalAction").mock.calls[0][0];
    expect(arg.lines.map((l: { debit_minor: number; credit_minor: number }) => [l.debit_minor, l.credit_minor])).toEqual([
      [150000000, 0],
      [0, 150000000],
    ]);
  });

  it("blocks an unreadable amount and says which line, instead of dropping it", () => {
    const { container } = openAndPickAccounts();
    const [debit1, , , credit2] = decimalInputs(container);
    type(debit1, "abc");
    type(credit2, "500");
    expect(screen.getByRole("alert").textContent).toContain("Line 1:");
    expect((screen.getByText("Post entry") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("Post entry"));
    expect(act("postManualJournalAction")).not.toHaveBeenCalled();
  });

  it("refuses a line that has an amount but no account, instead of posting without it", async () => {
    const { container } = render(<LedgerBrowser />);
    fireEvent.click(screen.getByText("New entry"));
    const accountSelects = screen.getAllByDisplayValue("Select…");
    type(accountSelects[1], "2000"); // line 1 left without an account
    const [debit1, , , credit2] = decimalInputs(container);
    type(debit1, "100");
    type(credit2, "100");
    fireEvent.click(screen.getByText("Post entry"));
    await waitFor(() => expect(screen.getByText(/Line 1 has an amount but no account/)).toBeTruthy());
    expect(act("postManualJournalAction")).not.toHaveBeenCalled();
  });
});

describe("bill", () => {
  it.each([
    ["2,500,000", 250000000, true],
    ["abc", null, false],
    ["0", null, false],
    ["-5", null, false],
  ])("amount %j", async (typed, expectedMinor, saved) => {
    hooks.useVendors = q([{ id: "v1", name: "Landlord", is_active: true }]);
    const { container } = render(<PayablesAndVendors />);
    fireEvent.click(screen.getByText("New bill"));
    const selects = screen.getAllByDisplayValue("Select…");
    type(selects[0], "v1");
    type(selects[1], "5000");
    type(decimalInputs(container)[0], typed);
    fireEvent.click(screen.getByText("Save as draft"));
    if (saved) {
      await waitFor(() => expect(act("createBillAction")).toHaveBeenCalledTimes(1));
      expect(act("createBillAction").mock.calls[0][0].amount_minor).toBe(expectedMinor);
    } else {
      await waitFor(() => expect(screen.getByText(/not an amount|more than zero|is negative/)).toBeTruthy());
      expect(act("createBillAction")).not.toHaveBeenCalled();
    }
  });
});

describe("budget", () => {
  it("saves a comma-separated budget in full, and refuses text", async () => {
    const { container } = render(<Budgets />);
    fireEvent.click(screen.getByText("New budget line"));
    type(screen.getAllByDisplayValue("Select…")[0], "5000");
    const amount = decimalInputs(container).at(-1) as HTMLInputElement;
    type(amount, "750,000");
    fireEvent.click(screen.getByText("Save budget"));
    await waitFor(() => expect(act("upsertBudgetAction")).toHaveBeenCalledTimes(1));
    expect(act("upsertBudgetAction").mock.calls[0][0].amount_minor).toBe(75000000);

    act("upsertBudgetAction").mockClear();
    fireEvent.click(screen.getByText("New budget line"));
    type(screen.getAllByDisplayValue("Select…")[0], "5000");
    type(decimalInputs(container).at(-1) as HTMLInputElement, "lots");
    fireEvent.click(screen.getByText("Save budget"));
    await waitFor(() => expect(screen.getByText(/not an amount/)).toBeTruthy());
    expect(act("upsertBudgetAction")).not.toHaveBeenCalled();
  });
});

describe("compliance: amount on a filed obligation", () => {
  const calendar = [
    { obligation_code: "paye_monthly", obligation_name: "PAYE", agency: "FIRS", period_label: "2026-10", due_date: "2026-11-10", status: "upcoming", description: null, filed_at: null, remittance_reference: null, amount_minor: null },
  ];
  beforeEach(() => { hooks.useComplianceCalendar = q(calendar); });

  it("records a comma amount in full, a blank amount as none, and refuses text", async () => {
    render(<ComplianceCalendar />);
    fireEvent.click(screen.getByText("Mark filed"));
    const amount = screen.getByPlaceholderText("Amount");
    type(amount, "1,200,000");
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(act("markFiledAction")).toHaveBeenCalledTimes(1));
    expect(act("markFiledAction").mock.calls[0][0].amount_minor).toBe(120000000);
  });

  it("a blank amount is recorded as no amount, not as zero", async () => {
    render(<ComplianceCalendar />);
    fireEvent.click(screen.getByText("Mark filed"));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(act("markFiledAction")).toHaveBeenCalledTimes(1));
    expect(act("markFiledAction").mock.calls[0][0].amount_minor).toBeUndefined();
  });

  it("text is refused, not recorded as a remittance of zero", async () => {
    render(<ComplianceCalendar />);
    fireEvent.click(screen.getByText("Mark filed"));
    type(screen.getByPlaceholderText("Amount"), "abc");
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText(/not an amount/)).toBeTruthy());
    expect(act("markFiledAction")).not.toHaveBeenCalled();
  });
});

describe("employer billing rate", () => {
  beforeEach(() => {
    hooks.useEmployerBillingSummary = q([
      { organisation_id: "o1", organisation_name: "Acme", organisation_type: "corporate", eligible_count: 10, activated_count: 4,
        price_per_member_minor: null, currency: null, effective_from: null, notes: null, billing_config_id: null, monthly_invoice_estimate_minor: null },
    ]);
  });
  it.each([
    ["1,500", 150000, true],
    ["abc", null, false],
  ])("rate %j", async (typed, minor, saved) => {
    const { container } = render(<EmployerBilling />);
    fireEvent.click(screen.getByText("Set rate"));
    type(decimalInputs(container)[0], typed);
    fireEvent.click(screen.getByText("Save"));
    if (saved) {
      await waitFor(() => expect(act("upsertEmployerBillingConfigAction")).toHaveBeenCalledTimes(1));
      expect(act("upsertEmployerBillingConfigAction").mock.calls[0][0].price_per_member_minor).toBe(minor);
    } else {
      await waitFor(() => expect(screen.getByText(/not an amount/)).toBeTruthy());
      expect(act("upsertEmployerBillingConfigAction")).not.toHaveBeenCalled();
    }
  });
});

describe("approval threshold", () => {
  beforeEach(() => {
    hooks.useApprovalSettings = q([{ currency: "NGN", threshold_minor: 100000000 }]);
  });
  it("saves a comma threshold in full", async () => {
    const { container } = render(<FinanceSettings />);
    const input = decimalInputs(container)[0];
    type(input, "2,000,000");
    fireEvent.blur(input);
    await waitFor(() => expect(act("upsertApprovalThresholdAction")).toHaveBeenCalledWith("NGN", 200000000));
  });
  it("says so when the value cannot be read, instead of ignoring it", async () => {
    const { container } = render(<FinanceSettings />);
    const input = decimalInputs(container)[0];
    type(input, "abc");
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByText(/NGN threshold not saved/)).toBeTruthy());
    expect(act("upsertApprovalThresholdAction")).not.toHaveBeenCalled();
  });
  it("says so for zero too", async () => {
    const { container } = render(<FinanceSettings />);
    const input = decimalInputs(container)[0];
    type(input, "0");
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByText(/more than zero/)).toBeTruthy());
    expect(act("upsertApprovalThresholdAction")).not.toHaveBeenCalled();
  });
});

describe("settlement import", () => {
  function fill(container: HTMLElement, gross: string, fees: string, net: string) {
    const [g, f, n] = decimalInputs(container);
    type(g, gross);
    type(f, fees);
    type(n, net);
  }
  it("imports comma amounts in full and shows the real variance", async () => {
    const { container } = render(<Reconciliation />);
    fill(container, "1,000,000", "15,000", "985,000");
    expect(within(container).getByText(/Variance:/).textContent).toMatch(/Variance: ₦0$/);
    fireEvent.click(screen.getByText("Import settlement"));
    await waitFor(() => expect(act("importSettlementAction")).toHaveBeenCalledTimes(1));
    const arg = act("importSettlementAction").mock.calls[0][0];
    expect([arg.gross_minor, arg.fees_minor, arg.net_minor]).toEqual([100000000, 1500000, 98500000]);
  });
  it("blank fees mean none, not an error", async () => {
    const { container } = render(<Reconciliation />);
    fill(container, "500", "", "500");
    fireEvent.click(screen.getByText("Import settlement"));
    await waitFor(() => expect(act("importSettlementAction")).toHaveBeenCalledTimes(1));
    expect(act("importSettlementAction").mock.calls[0][0].fees_minor).toBe(0);
  });
  it("shows what is wrong instead of a variance worked out from a guess, and does not import", () => {
    const { container } = render(<Reconciliation />);
    fill(container, "1,0o0", "", "1000");
    expect(within(container).getByText(/Variance:/).textContent).toContain("Gross:");
    fireEvent.click(screen.getByText("Import settlement"));
    expect(act("importSettlementAction")).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Gross:/).length).toBeGreaterThan(0);
  });
});
