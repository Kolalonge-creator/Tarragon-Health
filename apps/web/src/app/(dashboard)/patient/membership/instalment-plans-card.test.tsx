/** @jest-environment jsdom */
/**
 * S25b: the schedule of a pay-in-parts plan and the next part's pay button. Nothing at all for a person with no open plan, a calm and
 * visible message when access is paused, and the pay button sends the part id and nothing else.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { parseInstalmentPlans } from "@/lib/commerce/instalments";
import { InstalmentPlansCard } from "./instalment-plans-card";

const row = (seq: number, state: string, over: Record<string, unknown> = {}) => ({
  id: `part-${seq}`, seq, amount_kobo: seq === 1 ? 3_333_334 : 3_333_333, due_at: `2026-1${seq}-01T00:00:00Z`, state,
  paid_at: state === "paid" ? "2026-10-01T00:00:00Z" : null, overdue: false, ...over,
});
const plan = (over: Record<string, unknown> = {}) => ({
  plan_id: "plan-1", order_id: "order-1", state: "active", parts: 3, price_kobo: 10_000_000, paid_kobo: 3_333_334, grace_days: 5,
  first_paid_at: "2026-10-01T00:00:00Z", lapsed_at: null, access_ends_at: "2027-10-01T00:00:00Z", name_key: "catalog.membership_annual.name",
  is_buyer: true, next_instalment_id: "part-2", instalments: [row(1, "paid"), row(2, "pending"), row(3, "pending")], ...over,
});

let plans: { data: ReturnType<typeof parseInstalmentPlans> };
const payAsync = jest.fn();
jest.mock("@/lib/queries/commerce", () => {
  const actual = jest.requireActual("@/lib/queries/commerce");
  return { ...actual, useMyInstalmentPlans: () => plans, usePayInstalment: () => ({ mutateAsync: payAsync, isPending: false }) };
});

const go = jest.fn();
beforeEach(() => {
  plans = { data: parseInstalmentPlans([plan()]) };
  payAsync.mockReset();
  go.mockReset();
});

describe("InstalmentPlansCard (S25b)", () => {
  it("renders nothing for a person with no plan, or only a finished or closed one", () => {
    plans = { data: [] };
    const { container } = render(<InstalmentPlansCard locale="en" go={go} />);
    expect(container.innerHTML).toBe("");
    cleanup();
    plans = { data: parseInstalmentPlans([plan({ state: "completed", next_instalment_id: null }), plan({ plan_id: "plan-2", state: "cancelled" })]) };
    expect(render(<InstalmentPlansCard locale="en" go={go} />).container.innerHTML).toBe("");
  });

  it("shows how much is paid, each part with its date and the next part's pay button", () => {
    render(<InstalmentPlansCard locale="en" go={go} />);
    expect(screen.getByText(/1 of 3 paid/)).toBeTruthy();
    expect(screen.getByText("Your plan is up to date.")).toBeTruthy();
    expect(screen.getByText("Part 1")).toBeTruthy();
    expect(screen.getByText(/Paid on/)).toBeTruthy();
    expect(screen.getByText(/Your access runs until/)).toBeTruthy();
    expect(screen.getByText(/up to 5 days late before your access pauses/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Pay part 2 now/ })).toBeTruthy();
  });

  it("pays the next part by sending its id only, then opens Paystack", async () => {
    payAsync.mockResolvedValue({ order_id: "order-1", instalment_id: "part-2", reference: "thi_x", amount_kobo: 3_333_333, checkout_url: "https://checkout.paystack.com/p2" });
    render(<InstalmentPlansCard locale="en" go={go} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Pay part 2 now/ })));
    expect(payAsync).toHaveBeenCalledWith("part-2");
    expect(go).toHaveBeenCalledWith("https://checkout.paystack.com/p2");
  });

  it("says plainly when access is paused and how to get it back, as an alert", () => {
    plans = { data: parseInstalmentPlans([plan({ state: "lapsed", lapsed_at: "2026-11-10T00:00:00Z", instalments: [row(1, "paid"), row(2, "pending", { overdue: true }), row(3, "pending")] })]) };
    render(<InstalmentPlansCard locale="en" go={go} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Your access is paused. Pay the overdue part/);
    expect(screen.getByText(/Overdue since/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Pay part 2 now/ })).toBeTruthy();
  });

  it("gives someone who is not the buyer no pay button", () => {
    plans = { data: parseInstalmentPlans([plan({ is_buyer: false })]) };
    render(<InstalmentPlansCard locale="en" go={go} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows a calm message when Paystack cannot be opened and does not leave the page", async () => {
    const { CheckoutError } = jest.requireActual("@/lib/queries/commerce") as typeof import("@/lib/queries/commerce");
    payAsync.mockRejectedValue(new CheckoutError("pay_earlier_part_first"));
    render(<InstalmentPlansCard locale="en" go={go} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Pay part 2 now/ })));
    expect(screen.getByRole("alert").textContent).toMatch(/pay the earlier part first/i);
    expect(go).not.toHaveBeenCalled();
  });

  it("has no accessibility violations", async () => {
    await expectNoA11yViolations(<InstalmentPlansCard locale="en" go={go} />);
  });
});
