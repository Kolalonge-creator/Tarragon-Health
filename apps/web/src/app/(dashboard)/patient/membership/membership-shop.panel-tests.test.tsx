/** @jest-environment jsdom */
/**
 * The payment screen for Membership Plus (and the upgrade that adds the panel) says which tests the yearly blood panel holds, from the
 * same list the public pricing page uses. Membership, which has no panel, shows none.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { YEARLY_PANEL_TESTS as PRICING_PAGE_LIST } from "@/app/(marketing)/_content/pricing-ladder";
import { YEARLY_PANEL_TESTS } from "@/lib/commerce/yearly-panel-tests";
import { MembershipShop } from "./membership-shop";

const FEE = { localBasisPoints: 150, flatKobo: 10_000, flatWaivedBelowKobo: 250_000, capKobo: 200_000 };
const base = { kind: "membership", duration_days: 365, uses: null, components: {} };
const PLUS = { ...base, code: "membership_annual", name_key: "catalog.membership_annual.name", description_key: "catalog.membership_annual.description", included_keys: ["catalog.membership_annual.incl.1"], amount_kobo: 12_900_000 };
const EG = { ...base, code: "membership_annual_no_panel", name_key: "catalog.membership_annual_no_panel.name", description_key: "catalog.membership_annual_no_panel.description", included_keys: ["catalog.membership_annual_no_panel.incl.1"], amount_kobo: 8_400_000 };
const UP = { ...base, code: "membership_upgrade_plus", name_key: "catalog.membership_upgrade_plus.name", description_key: "catalog.membership_upgrade_plus.description", included_keys: ["catalog.membership_upgrade_plus.incl.1"], amount_kobo: 4_500_000 };

let catalogue: { data: unknown[]; isSuccess: boolean };
let membership: { data: { is_member: boolean; ends_at: string | null; source: string | null; tier?: "evergreen" | "plus" | null } };
jest.mock("@/lib/queries/commerce", () => {
  const actual = jest.requireActual("@/lib/queries/commerce");
  return {
    ...actual,
    useCatalogue: () => catalogue,
    useMyMembership: () => membership,
    useMyOrders: () => ({ data: [] }),
    useStartCheckout: () => ({ mutateAsync: jest.fn(), isPending: false }),
    useQuote: () => ({ data: null }),
    useSetMyPlusState: () => ({ mutate: jest.fn(), isError: false, error: null, isPending: false }),
    useAutoRenewEnabled: () => ({ data: false }),
  };
});
jest.mock("@/lib/queries/service-regions", () => ({ usePlusCollectionStates: () => ({ data: [{ state: "Lagos", display_name: "Lagos" }], isSuccess: true }) }));
jest.mock("@/lib/queries/care-access", () => ({ useSponsorableProfiles: () => ({ data: [] }) }));
jest.mock("@/lib/queries/order-refunds", () => ({ useRefundPolicy: () => ({ data: undefined }), useRequestOrderRefund: () => ({ mutateAsync: jest.fn(), isPending: false }) }));

beforeEach(() => {
  catalogue = { data: [PLUS, EG, UP], isSuccess: true };
  membership = { data: { is_member: false, ends_at: null, source: null, tier: null } };
});
afterEach(cleanup);

const allTests = YEARLY_PANEL_TESTS.flatMap((g) => g.tests);

describe("the yearly blood panel test list on the payment screen", () => {
  it("is the very list the public pricing page uses, not a second copy", () => {
    expect(YEARLY_PANEL_TESTS).toBe(PRICING_PAGE_LIST);
    expect(allTests.length).toBe(17);
  });

  it("lists every test of the panel under Membership Plus, behind a closed disclosure", () => {
    render(<MembershipShop locale="en" fee={{ ...FEE }} go={jest.fn()} />);
    const box = screen.getByTestId("panel-tests-membership_annual") as HTMLDetailsElement;
    expect(box.tagName).toBe("DETAILS");
    expect(box.open).toBe(false);
    expect(within(box).getByText("See the tests in the yearly blood panel")).toBeTruthy();
    for (const g of YEARLY_PANEL_TESTS) {
      expect(within(box).getByText(`${g.heading}:`, { exact: false })).toBeTruthy();
      for (const test of g.tests) expect(box.textContent).toContain(test);
    }
  });

  it("is not on the Membership card, which has no panel", () => {
    render(<MembershipShop locale="en" fee={{ ...FEE }} go={jest.fn()} />);
    expect(screen.queryByTestId("panel-tests-membership_annual_no_panel")).toBeNull();
    expect(screen.getAllByTestId(/^panel-tests-/).length).toBe(1);
    cleanup();
    catalogue = { data: [EG], isSuccess: true };
    render(<MembershipShop locale="en" fee={{ ...FEE }} go={jest.fn()} />);
    expect(screen.queryByTestId(/^panel-tests-/)).toBeNull();
  });

  it("is on the upgrade a Membership member sees, because the upgrade adds the panel", () => {
    membership = { data: { is_member: true, ends_at: "2027-08-01T00:00:00Z", source: "purchase", tier: "evergreen" } };
    render(<MembershipShop locale="en" fee={{ ...FEE }} go={jest.fn()} />);
    const box = screen.getByTestId("panel-tests-membership_upgrade_plus");
    for (const test of allTests) expect(box.textContent).toContain(test);
  });

  it("is also shown when Membership Plus is the only product on sale, because it includes the panel", () => {
    catalogue = { data: [PLUS], isSuccess: true };
    render(<MembershipShop locale="en" fee={{ ...FEE }} go={jest.fn()} />);
    expect(screen.getByTestId("panel-tests-membership_annual").textContent).toContain("HbA1c");
  });

  it("uses no dash and passes the accessibility check", async () => {
    const { container } = await expectNoA11yViolations(<MembershipShop locale="en" fee={{ ...FEE }} go={jest.fn()} />);
    expect(container.textContent ?? "").not.toMatch(/[—–]/);
  });
});
