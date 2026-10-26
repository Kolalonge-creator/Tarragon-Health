/** @jest-environment jsdom */
/**
 * Automatic renewal at checkout: the box exists only while the renewal switch is ON, only for the person's OWN Membership (never a gift,
 * never when they already hold one), starts UNTICKED, states the price, the timing and how to cancel beside it, and the tick is sent only
 * when given. While the switch is off the old "does not renew by itself" wording stays and nothing about renewal is sent.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { MembershipShop } from "./membership-shop";

const FEE = { localBasisPoints: 150, flatKobo: 10_000, flatWaivedBelowKobo: 250_000, capKobo: 200_000 };
const ITEM = {
  code: "membership_annual", kind: "membership", name_key: "catalog.membership_annual.name", description_key: "catalog.membership_annual.description",
  included_keys: ["catalog.membership_annual.incl.1"], duration_days: 365, uses: null, amount_kobo: 12_900_000, components: {},
};

let switchOn: boolean;
let catalogue: { data: unknown[]; isSuccess: boolean };
let membership: { data: { is_member: boolean; ends_at: string | null; source: string | null } };
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
    useAutoRenewEnabled: () => ({ data: switchOn }),
  };
});
jest.mock("@/lib/queries/care-access", () => ({ useSponsorableProfiles: () => lovedOnes }));
jest.mock("@/lib/queries/order-refunds", () => ({ useRefundPolicy: () => ({ data: undefined }), useRequestOrderRefund: () => ({ mutateAsync: jest.fn(), isPending: false }) }));

const go = jest.fn();
const pay = () => act(async () => fireEvent.click(screen.getByRole("button", { name: "Pay with Paystack" })));
beforeEach(() => {
  switchOn = true;
  lovedOnes = { data: [] };
  catalogue = { data: [ITEM], isSuccess: true };
  membership = { data: { is_member: false, ends_at: null, source: null } };
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({ order_id: "o1", reference: "tho_x", amount_kobo: 12_900_000, checkout_url: "https://checkout.paystack.com/abc" });
  go.mockReset();
});
afterEach(cleanup);

describe("MembershipShop: automatic renewal", () => {
  it("switch OFF: no box, the old wording, and no renewal field is ever sent", async () => {
    switchOn = false;
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    expect(screen.queryByRole("checkbox", { name: /Renew my Membership automatically/ })).toBeNull();
    expect(screen.getByText(/does not renew by itself/)).toBeTruthy();
    await pay();
    expect((mutateAsync.mock.calls[0]![0] as Record<string, unknown>).autoRenew).toBeUndefined();
  });

  it("switch ON: an UNTICKED box beside the price, the timing, the card-only limit and how to cancel", () => {
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    const box = screen.getByRole("checkbox", { name: /Renew my Membership automatically each year/ }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    const hint = document.getElementById(box.getAttribute("aria-describedby")!)!.textContent!;
    expect(hint).toMatch(/₦129,000 today/);
    expect(hint).toMatch(/up to 3 days before your year ends/);
    expect(hint).toMatch(/unless you cancel/);
    expect(hint).toMatch(/If the price has gone up since we last told you, we do not charge you/);
    expect(hint).toMatch(/cancel renewal in one tap/);
    expect(hint).toMatch(/keep the year you have paid for/);
    expect(screen.getByText(/Only a card payment can renew by itself/)).toBeTruthy();
    expect(screen.queryByText(/does not renew by itself\. We remind you 7 days/)).toBeNull();
  });

  it("an untouched box sends no renewal; a ticked box sends autoRenew once", async () => {
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    await pay();
    expect((mutateAsync.mock.calls[0]![0] as Record<string, unknown>).autoRenew).toBeUndefined();
    fireEvent.click(screen.getByRole("checkbox", { name: /Renew my Membership automatically/ }));
    await pay();
    expect(mutateAsync.mock.calls[1]![0]).toMatchObject({ code: "membership_annual", autoRenew: true });
  });

  it("paying for someone else offers no renewal (a gift never renews on the giver's card)", () => {
    lovedOnes = { data: [{ id: "p-mum", full_name: "Mum" }] };
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "p-mum" } });
    expect(screen.queryByRole("checkbox", { name: /Renew my Membership automatically/ })).toBeNull();
    expect(screen.getByText(/does not renew by itself/)).toBeTruthy();
  });

  it("someone who already holds a Membership is not offered a box", () => {
    membership = { data: { is_member: true, ends_at: "2027-10-06T00:00:00Z", source: "purchase" } };
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    expect(screen.queryByRole("checkbox", { name: /Renew my Membership automatically/ })).toBeNull();
  });

  it("has no accessibility violations with the renewal box on", async () => {
    await expectNoA11yViolations(<MembershipShop locale="en" fee={FEE} go={go} />);
  });
});
