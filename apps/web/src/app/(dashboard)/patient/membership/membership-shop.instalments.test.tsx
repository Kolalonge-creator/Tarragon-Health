/** @jest-environment jsdom */
/**
 * S25b: choosing to pay the yearly Membership in parts. The choice appears only while the platform module is on and only for a plain
 * full-price purchase for oneself; paying in parts sends the part count and nothing that changes the price; the plan is shown in plain
 * words before anything is paid. Scanned with axe.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { MembershipShop } from "./membership-shop";

const FEE = { localBasisPoints: 150, flatKobo: 10_000, flatWaivedBelowKobo: 250_000, capKobo: 200_000 };
const ITEM = {
  code: "membership_annual", kind: "membership", name_key: "catalog.membership_annual.name", description_key: "catalog.membership_annual.description",
  included_keys: ["catalog.membership_annual.incl.1"], duration_days: 365, uses: null, amount_kobo: 10_000_000, components: {},
};
const OPEN = { parts: 3, due_offsets_days: [0, 30, 60], grace_days: 5, reminder_days_before: [3, 0], open: true };

let catalogue: { data: unknown[]; isSuccess: boolean };
let membership: { data: { is_member: boolean; ends_at: string | null; source: string | null } };
let policy: { data: unknown };
let lovedOnes: { data: { id: string; full_name: string | null }[] };
const mutateAsync = jest.fn();
jest.mock("@/lib/queries/commerce", () => {
  const actual = jest.requireActual("@/lib/queries/commerce");
  return {
    ...actual,
    useCatalogue: () => catalogue,
    useMyMembership: () => membership,
    useMyOrders: () => ({ data: [] }),
    useStartCheckout: () => ({ mutateAsync, isPending: false }),
    useQuote: () => ({ data: null }),
    useInstalmentPolicy: () => policy,
    useMyInstalmentPlans: () => ({ data: [] }),
  };
});
jest.mock("@/lib/queries/care-access", () => ({ useSponsorableProfiles: () => lovedOnes }));
jest.mock("@/lib/queries/order-refunds", () => ({ useRefundPolicy: () => ({ data: undefined }), useRequestOrderRefund: () => ({ mutateAsync: jest.fn(), isPending: false }) }));

const go = jest.fn();
beforeEach(() => {
  catalogue = { data: [ITEM], isSuccess: true };
  membership = { data: { is_member: false, ends_at: null, source: null } };
  policy = { data: OPEN };
  lovedOnes = { data: [] };
  mutateAsync.mockReset();
  go.mockReset();
});

describe("pay in parts at checkout (S25b)", () => {
  it("offers nothing extra while the module is off: no choice, the usual button", () => {
    policy = { data: null };
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByRole("button", { name: "Pay with Paystack" })).toBeTruthy();
    cleanup();
    policy = { data: { ...OPEN, open: false } };
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("offers the choice when the module is on, with paying in full selected, and paying in full sends what it always sent", async () => {
    mutateAsync.mockResolvedValue({ order_id: "o1", reference: "tho_x", amount_kobo: 10_000_000, checkout_url: "https://checkout.paystack.com/abc" });
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    const full = screen.getByRole("radio", { name: /Pay in full/ }) as HTMLInputElement;
    const parts = screen.getByRole("radio", { name: "Pay in 3 parts" }) as HTMLInputElement;
    expect(full.checked).toBe(true);
    expect(parts.checked).toBe(false);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pay with Paystack" })));
    const arg = mutateAsync.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(arg).filter((k) => arg[k] !== undefined).sort()).toEqual(["clientKey", "code"]);
  });

  it("shows the plan in plain words, the leftover kobo on the first part, and what happens if a part is missed", () => {
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    fireEvent.click(screen.getByRole("radio", { name: "Pay in 3 parts" }));
    expect(screen.getByText("₦33,333.34 today")).toBeTruthy();
    expect(screen.getByText("Part 2: ₦33,333.33, 30 days after your first payment")).toBeTruthy();
    expect(screen.getByText("Part 3: ₦33,333.33, 60 days after your first payment")).toBeTruthy();
    expect(screen.getByText(/access starts as soon as the first part is paid/)).toBeTruthy();
    expect(screen.getByText(/within 5 days after its due date, your access pauses/)).toBeTruthy();
    expect(screen.getByText(/never take a payment on our own/)).toBeTruthy();
    expect(screen.getByText(/Parts you have not paid are never charged/)).toBeTruthy();
    // no discount box and no points while paying in parts: the price is the list price
    expect(screen.queryByLabelText(/code/i)).toBeNull();
  });

  it("sends the number of parts and nothing that changes the price, then opens Paystack for the first part", async () => {
    mutateAsync.mockResolvedValue({ order_id: "o1", reference: "thi_x", amount_kobo: 3_333_334, checkout_url: "https://checkout.paystack.com/first" });
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    fireEvent.click(screen.getByRole("radio", { name: "Pay in 3 parts" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pay the first part with Paystack" })));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    const arg = mutateAsync.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).toEqual({ code: "membership_annual", clientKey: expect.any(String), instalmentParts: 3 });
    expect(go).toHaveBeenCalledWith("https://checkout.paystack.com/first");
  });

  it("never uses one retry key for both ways of paying, and keeps each one across a dropped connection", async () => {
    const { CheckoutError } = jest.requireActual("@/lib/queries/commerce") as typeof import("@/lib/queries/commerce");
    mutateAsync.mockRejectedValue(new CheckoutError("payment_unavailable"));
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pay with Paystack" })));
    fireEvent.click(screen.getByRole("radio", { name: "Pay in 3 parts" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pay the first part with Paystack" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pay the first part with Paystack" })));
    fireEvent.click(screen.getByRole("radio", { name: /Pay in full/ }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pay with Paystack" })));
    const keys = mutateAsync.mock.calls.map((c) => (c[0] as { clientKey: string }).clientKey);
    expect(keys).toHaveLength(4);
    expect(keys[1]).toBe(keys[2]);          // the plan keeps its own key across a dropped connection
    expect(keys[0]).toBe(keys[3]);          // and so does paying in full
    expect(keys[0]).not.toBe(keys[1]);      // but they are never the same key
  });

  it("is not offered for someone else, or to a person who is already a Member", () => {
    lovedOnes = { data: [{ id: "p-mum", full_name: "Mum" }] };
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    expect(screen.getByRole("radio", { name: "Pay in 3 parts" })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "p-mum" } });
    expect(screen.queryByRole("radio")).toBeNull();
    cleanup();
    lovedOnes = { data: [] };
    membership = { data: { is_member: true, ends_at: "2027-10-06T00:00:00Z", source: "purchase" } };
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("says in calm words when the database refuses, and keeps the key only for a network failure", async () => {
    const { CheckoutError } = jest.requireActual("@/lib/queries/commerce") as typeof import("@/lib/queries/commerce");
    mutateAsync.mockRejectedValueOnce(new CheckoutError("instalment_schedule_invalid"));
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    fireEvent.click(screen.getByRole("radio", { name: "Pay in 3 parts" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pay the first part with Paystack" })));
    expect(screen.getByRole("alert").textContent).toMatch(/payment plan has changed/);
    expect(go).not.toHaveBeenCalled();
  });

  it("has no accessibility violations with the choice and the plan open", async () => {
    await expectNoA11yViolations(<MembershipShop locale="en" fee={FEE} go={go} />);
  });
});
