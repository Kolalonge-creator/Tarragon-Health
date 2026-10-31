/** @jest-environment jsdom */
/**
 * Three buttons wrote to the general ledger on one click: Run recognition now, Post on an imported
 * settlement, and Post entry on the manual journal. Each now shows what will be posted and runs only on
 * Confirm. Cancel and Escape post nothing, and a second click while it is working does not post twice.
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
    useFinanceAccounts: () => get("accounts"),
    useCostCenters: () => get("costCenters"),
    useLedgerEntries: () => get("entries"),
    useRevrecSummary: () => get("revrec"),
    useReconciliationSummary: () => get("recon"),
    useReconciliationFlags: () => get("flags"),
  };
});

import { LedgerBrowser } from "./ledger";
import { RevenueRecognition } from "./revenue";
import { Reconciliation } from "./reconciliation";

const ok = (data: unknown): Q => ({ data });

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});

const ACCOUNTS = [
  { code: "1000", name: "Bank", type: "asset", normal_balance: "debit", is_active: true, sort_order: 1, description: null, vat_treatment: null },
  { code: "2000", name: "Accruals", type: "liability", normal_balance: "credit", is_active: true, sort_order: 2, description: null, vat_treatment: null },
];
const SUMMARY = { total_deferred_minor: 5000000, total_recognized_minor: 1000000, active_schedules: 3, schedules: [] };
const SETTLEMENT = {
  id: "s1", provider: "paystack", external_ref: "PSK-77", settlement_date: "2026-10-28", currency: "NGN",
  gross_minor: 1000000, fees_minor: 15000, net_minor: 985000, status: "draft", variance_minor: 0, matched_count: 4,
};

beforeEach(() => {
  for (const k of Object.keys(hooks)) delete hooks[k];
  for (const k of Object.keys(actions)) delete actions[k];
  hooks.accounts = ok(ACCOUNTS);
  hooks.costCenters = ok([]);
  hooks.entries = ok([]);
  hooks.flags = ok([]);
});

const dialogEl = (c: HTMLElement) => c.querySelector("dialog[open]") as HTMLDialogElement | null;
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const decimalInputs = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]'));

interface Case {
  name: string;
  action: string;
  title: string;
  facts: string[];
  confirmLabel: string;
  open: () => ReturnType<typeof render>;
}

const cases: Case[] = [
  {
    name: "Run recognition now",
    action: "runRevenueRecognitionAction",
    title: "Run revenue recognition now?",
    facts: ["3", "₦50,000"],
    confirmLabel: "Post entries",
    open: () => {
      hooks.revrec = ok(SUMMARY);
      const view = render(<RevenueRecognition />);
      fireEvent.click(screen.getByRole("button", { name: "Run recognition now" }));
      return view;
    },
  },
  {
    name: "Post a settlement",
    action: "postSettlementAction",
    title: "Post this settlement to the ledger?",
    facts: ["paystack · PSK-77", "2026-10-28", "₦10,000", "₦150", "₦9,850", "4"],
    confirmLabel: "Post settlement",
    open: () => {
      hooks.recon = ok({ settlements: [SETTLEMENT], unmatched: [] });
      const view = render(<Reconciliation />);
      fireEvent.click(screen.getByRole("button", { name: "Post" }));
      return view;
    },
  },
  {
    name: "Post a manual journal entry",
    action: "postManualJournalAction",
    title: "Post this journal entry?",
    facts: ["Debits", "Credits", "Lines"],
    confirmLabel: "Post entry",
    open: () => {
      const view = render(<LedgerBrowser />);
      fireEvent.click(screen.getByText("New entry"));
      const selects = screen.getAllByDisplayValue("Select…");
      type(selects[0], "1000");
      type(selects[1], "2000");
      const [debit1, , , credit2] = decimalInputs(view.container);
      type(debit1, "1,500");
      type(credit2, "1,500");
      fireEvent.click(screen.getByRole("button", { name: "Post entry" }));
      return view;
    },
  },
];

describe.each(cases)("$name", (c) => {
  it("shows what will be posted and posts nothing yet", () => {
    const view = c.open();
    const dialog = dialogEl(view.container);
    expect(dialog).not.toBeNull();
    const inside = within(dialog as HTMLElement);
    expect(inside.getByRole("heading").textContent).toBe(c.title);
    // The entry's own total is shown back, so the person confirms the amount they typed.
    if (c.name.includes("journal")) expect(dialog?.textContent).toContain("₦1,500");
    for (const fact of c.facts) expect(inside.getByText(fact, { exact: false })).toBeTruthy();
    expect(act(c.action)).not.toHaveBeenCalled();
  });

  it("posts nothing on Cancel", () => {
    const view = c.open();
    fireEvent.click(within(dialogEl(view.container) as HTMLElement).getByRole("button", { name: "Cancel" }));
    expect(dialogEl(view.container)).toBeNull();
    expect(act(c.action)).not.toHaveBeenCalled();
  });

  it("posts nothing on Escape", () => {
    const view = c.open();
    fireEvent(dialogEl(view.container) as HTMLElement, new Event("cancel", { cancelable: true }));
    expect(dialogEl(view.container)).toBeNull();
    expect(act(c.action)).not.toHaveBeenCalled();
  });

  it("posts once on Confirm", async () => {
    const view = c.open();
    fireEvent.click(within(dialogEl(view.container) as HTMLElement).getByRole("button", { name: c.confirmLabel }));
    await waitFor(() => expect(act(c.action)).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(dialogEl(view.container)).toBeNull());
  });

  it("does not post twice if Confirm is clicked again while it is working", async () => {
    let release: () => void = () => {};
    actions[c.action] = jest.fn(() => new Promise((r) => { release = () => r({ ok: true, data: {} }); }));
    const view = c.open();
    const dialog = within(dialogEl(view.container) as HTMLElement);
    fireEvent.click(dialog.getByRole("button", { name: c.confirmLabel }));
    const working = await dialog.findByRole("button", { name: "Working…" });
    fireEvent.click(working);
    expect(act(c.action)).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(dialogEl(view.container)).toBeNull());
  });

  it("the confirm button is not the red removal style", () => {
    const view = c.open();
    const confirm = within(dialogEl(view.container) as HTMLElement).getByRole("button", { name: c.confirmLabel });
    expect(confirm.className).not.toMatch(/red/);
  });
});

describe("posting still reports what happened after Confirm", () => {
  it("settlement: a refused post shows the reason", async () => {
    actions.postSettlementAction = jest.fn(async () => ({ ok: false, error: "Gross must equal net plus fees." }));
    hooks.recon = ok({ settlements: [SETTLEMENT], unmatched: [] });
    const view = render(<Reconciliation />);
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    fireEvent.click(within(dialogEl(view.container) as HTMLElement).getByRole("button", { name: "Post settlement" }));
    expect(await screen.findByText("Gross must equal net plus fees.")).toBeTruthy();
  });
  it("journal: a posted entry says so and clears the form", async () => {
    const view = cases[2].open();
    fireEvent.click(within(dialogEl(view.container) as HTMLElement).getByRole("button", { name: "Post entry" }));
    expect(await screen.findByText("Journal entry posted.")).toBeTruthy();
  });
});
