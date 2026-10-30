/** @jest-environment jsdom */
/**
 * WP1 on the plan card: the not-included list with prices, the monthly equivalent beside a yearly price (always "billed once a year"),
 * nothing monthly when a sponsor covers the price, and the price-change card for someone who already holds the item.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { parseQuote } from "@tarragon/commerce";
import { MembershipShop } from "./membership-shop";

const FEE = { localBasisPoints: 150, flatKobo: 10_000, flatWaivedBelowKobo: 250_000, capKobo: 200_000, internationalBasisPoints: 390, internationalFlatKobo: 10_000 };
const YEAR = {
  code: "membership_annual", kind: "membership", name_key: "catalog.membership_annual.name", description_key: "catalog.membership_annual.description",
  included_keys: ["catalog.membership_annual.incl.1"], duration_days: 365, uses: null, amount_kobo: 8_400_000, components: {},
};
const line = (rule: string, amount: number, running: number) => ({ rule, label_key: `quote.line.${rule}`, amount_kobo: amount, running_kobo: running, applied: true, reason_key: null });
const plain = parseQuote({ item_code: "membership_annual", list_kobo: 8_400_000, amount_due_kobo: 8_400_000, lines: [line("list", 8_400_000, 8_400_000)] });
const covered = parseQuote({
  item_code: "membership_annual", list_kobo: 8_400_000, amount_due_kobo: 0, sponsor_share_kobo: 8_400_000, sponsor_name: "Acme",
  lines: [line("list", 8_400_000, 8_400_000), line("sponsor", -8_400_000, 0)],
});

let quote: unknown;
jest.mock("@/lib/queries/commerce", () => {
  const actual = jest.requireActual("@/lib/queries/commerce");
  return {
    ...actual,
    useCatalogue: () => ({ data: [YEAR], isSuccess: true }),
    useMyMembership: () => ({ data: { is_member: false, ends_at: null, source: null } }),
    useMyOrders: () => ({ data: [] }),
    useStartCheckout: () => ({ mutateAsync: jest.fn(), isPending: false }),
    useAutoRenewEnabled: () => ({ data: false }),
    useQuote: () => ({ data: quote }),
  };
});
jest.mock("@/lib/queries/care-access", () => ({ useSponsorableProfiles: () => ({ data: [] }) }));
jest.mock("@/lib/queries/order-refunds", () => ({ useRefundPolicy: () => ({ data: undefined }), useRequestOrderRefund: () => ({ mutateAsync: jest.fn(), isPending: false }) }));

beforeEach(() => { quote = plain; });
afterEach(cleanup);

const NOT_INCLUDED = {
  membership_annual: [
    { labelKey: "catalog.notincl.medicines", extraCode: null, amountKobo: null },
    { labelKey: "catalog.consultation_single.name", extraCode: "consultation_single", amountKobo: 1_500_000 },
    { labelKey: "catalog.lab_panel_standard.name", extraCode: "lab_panel_standard", amountKobo: null },
  ],
};

describe("the plan card", () => {
  it("lists what is not included with prices from the database and Ask us where there is none", () => {
    render(<MembershipShop locale="en" fee={FEE} notIncluded={NOT_INCLUDED} />);
    expect(screen.getByText("What is not included")).toBeTruthy();
    expect(screen.getByText("₦15,000")).toBeTruthy();
    expect(screen.getByText("Ask us")).toBeTruthy();
  });

  it("shows about a twelfth a month with the plain statement that it is billed once a year", () => {
    render(<MembershipShop locale="en" fee={FEE} showMonthly />);
    expect(screen.getByText("About ₦7,000 a month. Billed once a year, not monthly.")).toBeTruthy();
    // the only button pays the whole year: there is no monthly option anywhere
    expect(screen.queryByText(/per month|monthly payment|instal/i)).toBeNull();
  });

  it("shows nothing monthly while the switch is off, which is the default until the founder confirms", () => {
    render(<MembershipShop locale="en" fee={FEE} />);
    expect(screen.queryByText(/a month/)).toBeNull();
  });

  it("shows no monthly line when a sponsor covers the whole price", () => {
    quote = covered;
    render(<MembershipShop locale="en" fee={FEE} showMonthly />);
    expect(screen.queryByText(/a month/)).toBeNull();
  });

  it("works with no extra data at all (a failed read adds nothing and breaks nothing)", () => {
    render(<MembershipShop locale="en" fee={FEE} />);
    expect(screen.queryByText("What is not included")).toBeNull();
    expect(screen.queryByText("A price is changing")).toBeNull();
  });
});

describe("the price-change card", () => {
  const notice = { itemCode: "membership_annual", nameKey: "catalog.membership_annual.name", paidListKobo: 8_400_000, newKobo: 12_900_000, newFrom: "2026-12-01T00:00:00Z", endsAt: "2027-03-10T10:00:00Z" };

  it("appears for the signed-in person's own item", () => {
    render(<MembershipShop locale="en" fee={FEE} priceNotices={[notice]} />);
    expect(screen.getByText("A price is changing")).toBeTruthy();
  });

  it("does not appear when paying for someone else", () => {
    render(<MembershipShop locale="en" fee={FEE} priceNotices={[notice]} beneficiary={{ id: "p1", name: "Ada" }} />);
    expect(screen.queryByText("A price is changing")).toBeNull();
  });
});
