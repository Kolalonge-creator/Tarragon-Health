/** @jest-environment jsdom */
/**
 * Removing a budget line or a billing rate, undoing a filed statutory obligation and ignoring a fraud
 * signal or a reconciliation flag each ran on one click. They now show the record back and run only on
 * Confirm. Cancel and Escape do nothing, and a second click on Confirm does not run it twice.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

type Q = { data?: unknown; isLoading?: boolean; isError?: boolean };
const hooks: Record<string, Q> = {};
const actions: Record<string, jest.Mock> = {};
const act = (name: string) => (actions[name] ??= jest.fn(async () => ({ ok: true, data: {} })));

jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock("@/lib/finance/actions", () => new Proxy({ __esModule: true }, { get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : (...a: unknown[]) => act(k)(...a)) }));
jest.mock("@/lib/finance/queries", () => {
  const get = (name: string): Q => ({ data: undefined, isLoading: false, isError: false, ...hooks[name] });
  return {
    __esModule: true,
    financeKeys: { all: ["finance"] },
    fetchComplianceSuggestedAmount: jest.fn(),
    useFinanceAccounts: () => get("accounts"),
    useCostCenters: () => get("costCenters"),
    useBudgetVariance: () => get("variance"),
    useBudgets: () => get("budgets"),
    useEmployerBillingSummary: () => get("billing"),
    useComplianceCalendar: () => get("calendar"),
    useFraudSignals: () => get("fraud"),
    useReconciliationSummary: () => get("recon"),
    useReconciliationFlags: () => get("flags"),
  };
});

import { Budgets } from "./budgets";
import { EmployerBilling } from "./employer-billing";
import { ComplianceCalendar } from "./compliance";
import { FraudSignals } from "./fraud-signals";
import { Reconciliation } from "./reconciliation";

const ok = (data: unknown): Q => ({ data });

// jsdom does not implement the modal dialog methods the shared ConfirmDialog calls.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});

beforeEach(() => {
  for (const k of Object.keys(hooks)) delete hooks[k];
  for (const k of Object.keys(actions)) delete actions[k];
  hooks.accounts = ok([]);
  hooks.costCenters = ok([]);
});

const dialogEl = (c: HTMLElement) => c.querySelector("dialog") as HTMLDialogElement;
const isOpen = (c: HTMLElement) => dialogEl(c).hasAttribute("open");

interface Case {
  name: string;
  setup: () => void;
  render: () => ReturnType<typeof render>;
  trigger: string;
  title: string;
  facts: string[];
  confirmLabel: string;
  action: string;
  args: unknown[];
}

const cases: Case[] = [
  {
    name: "remove a budget line",
    setup: () => {
      hooks.variance = ok([]);
      hooks.budgets = ok([{ id: "b1", period_month: "2026-10-01", account_code: "5000", account_name: "Rent", cost_center_code: null, amount_minor: 15000000, currency: "NGN" }]);
    },
    render: () => render(<Budgets />),
    trigger: "Remove",
    title: "Remove this budget line?",
    facts: ["2026-10-01", "5000 · Rent", "Unassigned", "₦150,000"],
    confirmLabel: "Remove budget line",
    action: "deleteBudgetAction",
    args: ["b1"],
  },
  {
    name: "remove an employer billing rate",
    setup: () => {
      hooks.billing = ok([{ organisation_id: "o1", organisation_name: "Acme Ltd", organisation_type: "corporate", eligible_count: 10, activated_count: 4, price_per_member_minor: 150000, currency: "NGN", effective_from: null, notes: null, billing_config_id: "c1", monthly_invoice_estimate_minor: 600000 }]);
    },
    render: () => render(<EmployerBilling />),
    trigger: "Remove",
    title: "Remove this billing rate?",
    facts: ["Acme Ltd", "₦1,500 per member"],
    confirmLabel: "Remove billing rate",
    action: "deleteEmployerBillingConfigAction",
    args: ["c1"],
  },
  {
    name: "undo a filed obligation",
    setup: () => {
      hooks.calendar = ok([{ obligation_code: "paye_monthly", obligation_name: "PAYE", agency: "FIRS", period_label: "2026-09", due_date: "2026-10-10", status: "filed", description: null, filed_at: "2026-10-09", remittance_reference: "REF-77", amount_minor: 5000000 }]);
    },
    render: () => render(<ComplianceCalendar />),
    trigger: "Undo",
    title: "Mark this filing as not filed?",
    facts: ["PAYE", "2026-09", "REF-77", "₦50,000"],
    confirmLabel: "Mark as not filed",
    action: "unmarkFiledAction",
    args: ["paye_monthly", "2026-09"],
  },
  {
    name: "ignore a fraud signal",
    setup: () => {
      hooks.fraud = ok([{ id: "f1", detected_at: "2026-10-30T10:00:00Z", severity: "high", signal_type: "duplicate_transaction", detail: null, amount_minor: 500000, currency: "NGN" }]);
    },
    render: () => render(<FraudSignals />),
    trigger: "Ignore",
    title: "Ignore this fraud signal?",
    facts: ["Duplicate charge", "high", "₦5,000"],
    confirmLabel: "Ignore signal",
    action: "resolveFraudSignalAction",
    args: ["f1", "ignored"],
  },
  {
    name: "ignore a reconciliation flag",
    setup: () => {
      hooks.recon = ok({ settlements: [], unmatched: [] });
      hooks.flags = ok([{ id: "r1", detected_at: "2026-10-30T10:00:00Z", provider: "paystack", flag_type: "missing_locally", provider_reference: "ref_abc123", local_amount_minor: null, provider_amount_minor: 500000, currency: "NGN", local_status: null, provider_status: null }]);
    },
    render: () => render(<Reconciliation />),
    trigger: "Ignore",
    title: "Ignore this reconciliation flag?",
    facts: ["paystack", "ref_abc123", "2026-10-30"],
    confirmLabel: "Ignore flag",
    action: "resolveReconciliationFlagAction",
    args: ["r1", "ignored"],
  },
];

describe.each(cases)("$name", (c) => {
  beforeEach(() => c.setup());

  it("shows the record back and does nothing yet", () => {
    const view = c.render();
    expect(isOpen(view.container)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: c.trigger }));
    expect(isOpen(view.container)).toBe(true);
    const dialog = within(dialogEl(view.container));
    expect(dialog.getByRole("heading").textContent).toBe(c.title);
    for (const fact of c.facts) expect(dialog.getByText(fact, { exact: false })).toBeTruthy();
    expect(act(c.action)).not.toHaveBeenCalled();
  });

  it("does nothing on Cancel", () => {
    const view = c.render();
    fireEvent.click(screen.getByRole("button", { name: c.trigger }));
    fireEvent.click(within(dialogEl(view.container)).getByRole("button", { name: "Cancel" }));
    expect(isOpen(view.container)).toBe(false);
    expect(act(c.action)).not.toHaveBeenCalled();
  });

  it("does nothing on Escape", () => {
    const view = c.render();
    fireEvent.click(screen.getByRole("button", { name: c.trigger }));
    fireEvent(dialogEl(view.container), new Event("cancel", { cancelable: true }));
    expect(isOpen(view.container)).toBe(false);
    expect(act(c.action)).not.toHaveBeenCalled();
  });

  it("runs the action once, with the right record, on Confirm", async () => {
    const view = c.render();
    fireEvent.click(screen.getByRole("button", { name: c.trigger }));
    fireEvent.click(within(dialogEl(view.container)).getByRole("button", { name: c.confirmLabel }));
    await waitFor(() => expect(act(c.action)).toHaveBeenCalledTimes(1));
    expect(act(c.action)).toHaveBeenCalledWith(...c.args);
    await waitFor(() => expect(isOpen(view.container)).toBe(false));
  });

  it("does not run twice if Confirm is clicked again while it is working", async () => {
    let release: () => void = () => {};
    actions[c.action] = jest.fn(() => new Promise((r) => { release = () => r({ ok: true, data: {} }); }));
    const view = c.render();
    fireEvent.click(screen.getByRole("button", { name: c.trigger }));
    const dialog = within(dialogEl(view.container));
    fireEvent.click(dialog.getByRole("button", { name: c.confirmLabel }));
    const working = await dialog.findByRole("button", { name: "Working…" });
    expect((working as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(working);
    expect(act(c.action)).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(isOpen(view.container)).toBe(false));
  });
});

describe("the ordinary, reversible actions are not asked about", () => {
  it("Resolve on a fraud signal runs at once", async () => {
    hooks.fraud = ok([{ id: "f1", detected_at: "2026-10-30T10:00:00Z", severity: "high", signal_type: "chargeback", detail: null, amount_minor: null, currency: null }]);
    const view = render(<FraudSignals />);
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    expect(isOpen(view.container)).toBe(false);
    await waitFor(() => expect(act("resolveFraudSignalAction")).toHaveBeenCalledWith("f1", "resolved"));
  });
  it("Resolved on a reconciliation flag runs at once", async () => {
    hooks.recon = ok({ settlements: [], unmatched: [] });
    hooks.flags = ok([{ id: "r1", detected_at: "2026-10-30T10:00:00Z", provider: "paystack", flag_type: "missing_locally", provider_reference: "ref_abc123", local_amount_minor: null, provider_amount_minor: null, currency: null, local_status: null, provider_status: null }]);
    const view = render(<Reconciliation />);
    fireEvent.click(screen.getByRole("button", { name: "Resolved" }));
    expect(isOpen(view.container)).toBe(false);
    await waitFor(() => expect(act("resolveReconciliationFlagAction")).toHaveBeenCalledWith("r1", "resolved"));
  });
});
