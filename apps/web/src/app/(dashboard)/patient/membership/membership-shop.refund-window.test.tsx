/** @jest-environment jsdom */
/**
 * The order history offers "Request refund" only while the database would accept it. Outside the window the button goes and a short line
 * says so, using the active policy's number of days (21 for a Membership, the cooling-off days for anything else).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { MembershipShop } from "./membership-shop";

const FEE = { localBasisPoints: 150, flatKobo: 10_000, flatWaivedBelowKobo: 250_000, capKobo: 200_000 };
const MEMBERSHIP = {
  code: "membership_annual", kind: "membership", name_key: "catalog.membership_annual.name", description_key: "catalog.membership_annual.description",
  included_keys: ["catalog.membership_annual.incl.1"], duration_days: 365, uses: null, amount_kobo: 12_900_000, components: {},
};
const CONSULT = {
  code: "proof_consult", kind: "consultation", name_key: "catalog.consultation_single.name", description_key: "catalog.consultation_single.description",
  included_keys: ["catalog.consultation_single.incl.1"], duration_days: null, uses: 1, amount_kobo: 500_000, components: { partner_fee: 300_000, tarragon_service_fee: 200_000 },
};

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number): string => new Date(Date.now() - n * DAY_MS).toISOString();
const order = (over: Record<string, unknown>) => ({
  order_id: "o1", state: "paid", amount_kobo: 12_900_000, fee_kobo: 0, total_kobo: 12_900_000, code: "membership_annual", name_key: "catalog.membership_annual.name",
  created_at: daysAgo(1), paid_at: daysAgo(1), sponsor_share_kobo: 0, sponsor_name: null, is_buyer: true, refund_state: null, ...over,
});

let orders: unknown[];
let policy: unknown;
jest.mock("@/lib/queries/commerce", () => {
  const actual = jest.requireActual("@/lib/queries/commerce");
  return {
    ...actual,
    useCatalogue: () => ({ data: [MEMBERSHIP, CONSULT], isSuccess: true }),
    useMyMembership: () => ({ data: { is_member: false, ends_at: null, source: null } }),
    useMyOrders: () => ({ data: orders }),
    useStartCheckout: () => ({ mutateAsync: jest.fn(), isPending: false }),
    useQuote: () => ({ data: null }),
    useAutoRenewEnabled: () => ({ data: false }),
  };
});
jest.mock("@/lib/queries/care-access", () => ({ useSponsorableProfiles: () => ({ data: [] }) }));
jest.mock("@/lib/queries/order-refunds", () => ({ useRefundPolicy: () => ({ data: policy }), useRequestOrderRefund: () => ({ mutateAsync: jest.fn(), isPending: false }) }));
jest.mock("@/lib/queries/service-regions", () => ({ usePlusCollectionStates: () => ({ data: [], isSuccess: true }) }));

beforeEach(() => {
  orders = [];
  policy = undefined;
});
afterEach(cleanup);

const button = () => screen.queryByRole("button", { name: "Request refund" });

describe("refund button in the order history", () => {
  it("is offered for a Membership paid 20 days ago, inside the 21-day window", () => {
    orders = [order({ paid_at: daysAgo(20) })];
    render(<MembershipShop locale="en" fee={FEE} go={jest.fn()} />);
    expect(button()).toBeTruthy();
    expect(screen.queryByText(/refund window has passed/)).toBeNull();
  });

  it("is gone for a Membership paid 22 days ago, and a short line says the window has passed", () => {
    orders = [order({ paid_at: daysAgo(22) })];
    render(<MembershipShop locale="en" fee={FEE} go={jest.fn()} />);
    expect(button()).toBeNull();
    expect(screen.getByText("The 21-day refund window has passed.")).toBeTruthy();
  });

  it("takes the number of days from the active policy, not from a fixed 21", () => {
    // what useRefundPolicy hands back once the database has answered: the already parsed policy
    policy = { coolingOffDays: 14, membershipWindowDays: 30, decisionSlaDays: 3, bankDaysMin: 5, bankDaysMax: 10, graceDays: 7 };
    orders = [order({ paid_at: daysAgo(25) })];
    render(<MembershipShop locale="en" fee={FEE} go={jest.fn()} />);
    expect(button()).toBeTruthy();
    cleanup();
    orders = [order({ paid_at: daysAgo(31) })];
    render(<MembershipShop locale="en" fee={FEE} go={jest.fn()} />);
    expect(button()).toBeNull();
    expect(screen.getByText("The 30-day refund window has passed.")).toBeTruthy();
  });

  it("a one-off order uses the shorter cooling-off window, not the Membership one", () => {
    orders = [order({ code: "proof_consult", name_key: "catalog.consultation_single.name", amount_kobo: 500_000, total_kobo: 500_000, paid_at: daysAgo(15) })];
    render(<MembershipShop locale="en" fee={FEE} go={jest.fn()} />);
    expect(button()).toBeNull();
    expect(screen.getByText("The 14-day refund window has passed.")).toBeTruthy();
    cleanup();
    orders = [order({ code: "proof_consult", name_key: "catalog.consultation_single.name", amount_kobo: 500_000, total_kobo: 500_000, paid_at: daysAgo(13) })];
    render(<MembershipShop locale="en" fee={FEE} go={jest.fn()} />);
    expect(button()).toBeTruthy();
  });

  it("an order whose item is no longer in the catalogue gets the longer window, so a right the database honours is not hidden", () => {
    orders = [order({ code: "retired_item", paid_at: daysAgo(18) })];
    render(<MembershipShop locale="en" fee={FEE} go={jest.fn()} />);
    expect(button()).toBeTruthy();
  });

  it("says nothing extra where there was never a button: not the buyer, or a refund already asked for", () => {
    orders = [order({ paid_at: daysAgo(40), is_buyer: false }), order({ order_id: "o2", paid_at: daysAgo(40), refund_state: "pending" })];
    render(<MembershipShop locale="en" fee={FEE} go={jest.fn()} />);
    expect(button()).toBeNull();
    expect(screen.queryByText(/refund window has passed/)).toBeNull();
  });
});
