/** @jest-environment jsdom */
/**
 * The Membership screen (S25): shows what is included, the price and an ESTIMATED fee labelled as one, sends only the item code
 * and a retry key to checkout (never an amount), reuses the key when a tap fails on the network, and does not offer to buy a
 * second membership. Scanned with axe.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { CheckoutError } from "@/lib/queries/commerce";
import { MembershipShop } from "./membership-shop";

const FEE = { localBasisPoints: 150, flatKobo: 10_000, flatWaivedBelowKobo: 250_000, capKobo: 200_000 };
const ITEM = {
  code: "membership_annual", kind: "membership", name_key: "catalog.membership_annual.name", description_key: "catalog.membership_annual.description",
  included_keys: ["catalog.membership_annual.incl.1", "catalog.membership_annual.incl.2"], duration_days: 365, uses: null, amount_kobo: 10_000_000, components: {},
};

let catalogue: { data: unknown[]; isSuccess: boolean };
let membership: { data: { is_member: boolean; ends_at: string | null; source: string | null } };
let orders: { data: unknown[] };
const mutateAsync = jest.fn();
jest.mock("@/lib/queries/commerce", () => {
  const actual = jest.requireActual("@/lib/queries/commerce");
  return {
    ...actual,
    useCatalogue: () => catalogue,
    useMyMembership: () => membership,
    useMyOrders: () => orders,
    useStartCheckout: () => ({ mutateAsync, isPending: false }),
  };
});

const assign = jest.fn();
beforeEach(() => {
  catalogue = { data: [ITEM], isSuccess: true };
  membership = { data: { is_member: false, ends_at: null, source: null } };
  orders = { data: [] };
  mutateAsync.mockReset();
  assign.mockReset();
});

describe("MembershipShop", () => {
  it("shows the item, what is included, the price and an estimated fee labelled as an estimate", async () => {
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.getByText("Tarragon Membership")).toBeTruthy();
    expect(screen.getByText(/A video call with your care team every month/)).toBeTruthy();
    expect(screen.getByText("₦100,000")).toBeTruthy();
    expect(screen.getAllByText(/about ₦/).length).toBe(2);
    expect(screen.getByText(/estimate/i)).toBeTruthy();
    expect(screen.getByText(/does not renew by itself/)).toBeTruthy();
    cleanup();
    await expectNoA11yViolations(<MembershipShop locale="en" fee={FEE} go={assign} />);
  });

  it("sends only the item code and a retry key, then opens Paystack", async () => {
    mutateAsync.mockResolvedValue({ order_id: "o1", reference: "tho_x", amount_kobo: 10_000_000, checkout_url: "https://checkout.paystack.com/abc" });
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pay with Paystack" })));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    const arg = mutateAsync.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(arg).sort()).toEqual(["clientKey", "code"]);
    expect(arg.code).toBe("membership_annual");
    expect(assign).toHaveBeenCalledWith("https://checkout.paystack.com/abc");
  });

  it("keeps the same retry key after a network failure so a retry is the same order, and makes a new one after a refusal", async () => {
    mutateAsync.mockRejectedValueOnce(new CheckoutError("payment_unavailable")).mockRejectedValueOnce(new CheckoutError("no_capacity")).mockRejectedValue(new CheckoutError("unknown"));
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    const click = () => act(async () => fireEvent.click(screen.getByRole("button", { name: "Pay with Paystack" })));
    await click();
    await click();
    await click();
    const keys = mutateAsync.mock.calls.map((c) => (c[0] as { clientKey: string }).clientKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/Something went wrong/);
  });

  it("tells the patient when membership is closed, in their own words, never an error", () => {
    catalogue = { data: [], isSuccess: true };
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.getByText(/Membership is not open yet/)).toBeTruthy();
  });

  it("does not offer a second membership to a member, and says until when", () => {
    membership = { data: { is_member: true, ends_at: "2027-10-06T00:00:00Z", source: "purchase" } };
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.queryByRole("button", { name: "Pay with Paystack" })).toBeNull();
    expect(screen.getAllByText(/You are a member until/).length).toBeGreaterThan(0);
  });

  it("lists payments with the amount actually charged and their state, and works in Pidgin", () => {
    orders = { data: [{ order_id: "o1", state: "paid", amount_kobo: 500_000, fee_kobo: 150, total_kobo: 500_150, code: "x_item", name_key: "catalog.bp_care_pack_3m.name", created_at: "2026-10-06T10:00:00Z", paid_at: "2026-10-06T10:01:00Z" }] };
    render(<MembershipShop locale="pcm" fee={FEE} go={assign} />);
    expect(screen.getByText("₦5,001.50")).toBeTruthy();
    expect(screen.getByText("Paid")).toBeTruthy();
    expect(screen.getByText("Wetin dey inside")).toBeTruthy();
  });

  it("shows nothing for a copy key this build does not know, never the raw key", () => {
    catalogue = { data: [{ ...ITEM, name_key: "catalog.future.name", included_keys: ["catalog.future.incl.1"] }], isSuccess: true };
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.queryByText(/catalog\.future/)).toBeNull();
  });
});
