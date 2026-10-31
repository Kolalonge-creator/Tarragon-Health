/** @jest-environment jsdom */
/**
 * Voiding a draft bill asked for its reason with a browser prompt: Cancel and an empty box both did
 * nothing with no word said, a box of spaces counted as a reason, and the bill was never shown back.
 * It now uses the same dialog as Approve and Pay, with the reason typed inside it.
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
    useVendors: () => get("vendors"),
    useBills: () => get("bills"),
    useApAging: () => get("aging"),
    useFinanceAccounts: () => get("accounts"),
  };
});

import { PayablesAndVendors } from "./payables";

const ok = (data: unknown): Q => ({ data });
const bill = (over: Record<string, unknown> = {}) => ({
  id: "b1", bill_no: 12, vendor_id: "v1", vendor_name: "Acme Cleaning", bill_date: "2026-10-20", due_date: null, currency: "NGN",
  amount_minor: 4500000, expense_account_code: "5000", cost_center_code: null, description: "October cleaning", status: "draft", wht_minor: 0, paid_at: null,
  ...over,
});

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
  window.prompt = jest.fn();
});

beforeEach(() => {
  for (const k of Object.keys(hooks)) delete hooks[k];
  for (const k of Object.keys(actions)) delete actions[k];
  (window.prompt as jest.Mock).mockClear();
  hooks.vendors = ok([]);
  hooks.aging = ok([]);
  hooks.accounts = ok([]);
  hooks.bills = ok([bill()]);
});

const open = (c: HTMLElement) => c.querySelector("dialog[open]") as HTMLElement | null;
const openVoid = () => {
  const view = render(<PayablesAndVendors />);
  fireEvent.click(screen.getByRole("button", { name: "Void" }));
  return view;
};
const confirmBtn = (c: HTMLElement) => within(open(c) as HTMLElement).getByRole("button", { name: "Void bill" }) as HTMLButtonElement;
const reasonBox = (c: HTMLElement) => within(open(c) as HTMLElement).getByLabelText(/Reason for voiding/) as HTMLInputElement;

describe("void a draft bill", () => {
  it("shows the bill back in the dialog and never uses a browser prompt", () => {
    const view = openVoid();
    const dialog = within(open(view.container) as HTMLElement);
    expect(dialog.getByRole("heading").textContent).toBe("Void this draft bill?");
    for (const fact of ["Acme Cleaning", "#12", "₦45,000", "October cleaning"]) expect(dialog.getByText(fact, { exact: false })).toBeTruthy();
    // Nothing is posted for a draft, so the posting rows do not appear.
    expect(dialog.queryByText("Withholding tax")).toBeNull();
    expect(dialog.queryByText("Net to vendor")).toBeNull();
    expect(window.prompt).not.toHaveBeenCalled();
    expect(act("voidBillAction")).not.toHaveBeenCalled();
  });

  it("cannot be confirmed without a reason, including a reason of only spaces", () => {
    const view = openVoid();
    expect(confirmBtn(view.container).disabled).toBe(true);
    fireEvent.change(reasonBox(view.container), { target: { value: "   " } });
    expect(confirmBtn(view.container).disabled).toBe(true);
    fireEvent.click(confirmBtn(view.container));
    expect(act("voidBillAction")).not.toHaveBeenCalled();
  });

  it("voids once with the trimmed reason on Confirm", async () => {
    const view = openVoid();
    fireEvent.change(reasonBox(view.container), { target: { value: "  Entered twice  " } });
    fireEvent.click(confirmBtn(view.container));
    await waitFor(() => expect(act("voidBillAction")).toHaveBeenCalledTimes(1));
    expect(act("voidBillAction")).toHaveBeenCalledWith("b1", "Entered twice");
    expect(await screen.findByText("Bill voided.")).toBeTruthy();
    expect(open(view.container)).toBeNull();
  });

  it("voids nothing on Cancel or Escape", () => {
    const view = openVoid();
    fireEvent.change(reasonBox(view.container), { target: { value: "Entered twice" } });
    fireEvent.click(within(open(view.container) as HTMLElement).getByRole("button", { name: "Cancel" }));
    expect(open(view.container)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Void" }));
    fireEvent(open(view.container) as HTMLElement, new Event("cancel", { cancelable: true }));
    expect(open(view.container)).toBeNull();
    expect(act("voidBillAction")).not.toHaveBeenCalled();
  });

  it("starts with an empty reason each time, not the last one", () => {
    const view = openVoid();
    fireEvent.change(reasonBox(view.container), { target: { value: "Entered twice" } });
    fireEvent.click(within(open(view.container) as HTMLElement).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Void" }));
    expect(reasonBox(view.container).value).toBe("");
  });

  it("shows the reason the server gave when the void is refused", async () => {
    actions.voidBillAction = jest.fn(async () => ({ ok: false, error: "only a draft bill can be voided directly" }));
    const view = openVoid();
    fireEvent.change(reasonBox(view.container), { target: { value: "Entered twice" } });
    fireEvent.click(confirmBtn(view.container));
    expect(await screen.findByText("only a draft bill can be voided directly")).toBeTruthy();
  });

  it("does not void twice if Confirm is clicked again while it is working", async () => {
    let release: () => void = () => {};
    actions.voidBillAction = jest.fn(() => new Promise((r) => { release = () => r({ ok: true }); }));
    const view = openVoid();
    fireEvent.change(reasonBox(view.container), { target: { value: "Entered twice" } });
    fireEvent.click(confirmBtn(view.container));
    fireEvent.click(confirmBtn(view.container));
    expect(act("voidBillAction")).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(open(view.container)).toBeNull());
  });

  it("Approve still shows its own dialog with the posting rows", () => {
    const view = render(<PayablesAndVendors />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = within(open(view.container) as HTMLElement);
    expect(dialog.getByRole("heading").textContent).toBe("Approve this bill?");
    expect(dialog.getByText("Withholding tax")).toBeTruthy();
    expect(dialog.queryByLabelText(/Reason for voiding/)).toBeNull();
  });
});
