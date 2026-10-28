/** @jest-environment jsdom */
/**
 * S71 A4: "You pay X. {Sponsor} pays Y." on the order history when a sponsor part-covered an order.
 * Nothing is said when the person paid it all or the sponsor covered all of it (that has its own "Covered by" wording).
 * The sponsor's name is shown only when the database sent it; otherwise the generic words are used.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { parseQuote } from "@tarragon/commerce";
import { MembershipShop } from "./membership-shop";

const FEE = { localBasisPoints: 150, flatKobo: 10_000, flatWaivedBelowKobo: 250_000, capKobo: 200_000, internationalBasisPoints: 390, internationalFlatKobo: 10_000 };
const ITEM = {
  code: "proof_consult", kind: "consultation", name_key: "catalog.consultation_single.name", description_key: "catalog.consultation_single.description",
  included_keys: [], duration_days: null, uses: 1, amount_kobo: 500_000, components: {},
};
const plain = parseQuote({ item_code: "proof_consult", list_kobo: 500_000, amount_due_kobo: 500_000, lines: [{ rule: "list", label_key: "quote.line.list", amount_kobo: 500_000, running_kobo: 500_000, applied: true, reason_key: null }] });

let orders: unknown[];
jest.mock("@/lib/queries/commerce", () => {
  const actual = jest.requireActual("@/lib/queries/commerce");
  return {
    ...actual,
    useCatalogue: () => ({ data: [ITEM], isSuccess: true }),
    useMyMembership: () => ({ data: { is_member: false, ends_at: null, source: null } }),
    useMyOrders: () => ({ data: orders }),
    useStartCheckout: () => ({ mutateAsync: jest.fn(), isPending: false }),
    useQuote: () => ({ data: plain }),
  };
});
jest.mock("@/lib/queries/care-access", () => ({ useSponsorableProfiles: () => ({ data: [] }) }));
jest.mock("@/lib/queries/order-refunds", () => ({ useRefundPolicy: () => ({ data: undefined }), useRequestOrderRefund: () => ({ mutateAsync: jest.fn(), isPending: false }) }));

const base = { order_id: "o1", state: "paid", fee_kobo: null, code: "proof_consult", name_key: "catalog.consultation_single.name", created_at: "2026-10-01T10:00:00Z", paid_at: "2026-10-01T10:05:00Z", is_buyer: true, refund_state: null };
afterEach(cleanup);

describe("sponsor split on the order history (A4)", () => {
  it("a part-covered order says what the person pays and what the sponsor pays, in whole naira from integer kobo", () => {
    orders = [{ ...base, amount_kobo: 300_000, total_kobo: 300_000, sponsor_share_kobo: 200_000, sponsor_name: "Acme Ltd" }];
    render(<MembershipShop locale="en" fee={FEE} />);
    expect(screen.getByText("You pay ₦3,000. Acme Ltd pays ₦2,000.")).toBeTruthy();
  });

  it("uses the generic words when the database did not send a sponsor name", () => {
    orders = [{ ...base, amount_kobo: 300_000, total_kobo: null, sponsor_share_kobo: 200_000, sponsor_name: null }];
    render(<MembershipShop locale="en" fee={FEE} />);
    expect(screen.getByText("You pay ₦3,000. Your sponsor pays ₦2,000.")).toBeTruthy();
  });

  it("says nothing when the person paid everything", () => {
    orders = [{ ...base, amount_kobo: 500_000, total_kobo: 500_000, sponsor_share_kobo: 0, sponsor_name: null }];
    render(<MembershipShop locale="en" fee={FEE} />);
    expect(screen.queryByText(/You pay ₦/)).toBeNull();
  });

  it("says nothing when the sponsor covered it all (it has its own Covered by wording)", () => {
    orders = [{ ...base, amount_kobo: 0, total_kobo: null, sponsor_share_kobo: 500_000, sponsor_name: "Acme Ltd" }];
    render(<MembershipShop locale="en" fee={FEE} />);
    expect(screen.queryByText(/You pay ₦/)).toBeNull();
    expect(screen.getByText("Covered by Acme Ltd")).toBeTruthy();
  });
});
