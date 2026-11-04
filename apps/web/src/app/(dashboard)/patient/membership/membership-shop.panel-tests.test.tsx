/** @jest-environment jsdom */
/**
 * T2-01 (2026-11-04): the yearly blood panel is no longer sold. Laboratory tests are not part of the Membership, so the payment screen
 * never lists the panel's tests, even when a stale catalogue still returns Membership Plus or the upgrade.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { MembershipShop } from "./membership-shop";

const FEE = { localBasisPoints: 150, flatKobo: 10_000, flatWaivedBelowKobo: 250_000, capKobo: 200_000 };
const base = { kind: "membership", duration_days: 365, uses: null, components: {} };
const PLUS = { ...base, code: "membership_annual", name_key: "catalog.membership_annual.name", description_key: "catalog.membership_annual.description", included_keys: ["catalog.membership_annual.incl.1"], amount_kobo: 12_000_000 };
const EG = { ...base, code: "membership_annual_no_panel", name_key: "catalog.membership_annual_no_panel.name", description_key: "catalog.membership_annual_no_panel.description", included_keys: ["catalog.membership_annual_no_panel.incl.1"], amount_kobo: 10_000_000 };
const UP = { ...base, code: "membership_upgrade_plus", name_key: "catalog.membership_upgrade_plus.name", description_key: "catalog.membership_upgrade_plus.description", included_keys: ["catalog.membership_upgrade_plus.incl.1"], amount_kobo: 4_000_000 };

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

describe("no yearly blood panel on the payment screen", () => {
  it("lists no panel tests for a Free person, even with Plus and the upgrade in the catalogue", () => {
    const { container } = render(<MembershipShop locale="en" fee={{ ...FEE }} go={jest.fn()} />);
    expect(screen.queryByTestId(/^panel-tests-/)).toBeNull();
    expect(container.textContent ?? "").not.toContain("HbA1c");
  });

  it("lists no panel tests for a Membership member (no upgrade is offered)", () => {
    membership = { data: { is_member: true, ends_at: "2027-08-01T00:00:00Z", source: "purchase", tier: "evergreen" } };
    render(<MembershipShop locale="en" fee={{ ...FEE }} go={jest.fn()} />);
    expect(screen.queryByTestId(/^panel-tests-/)).toBeNull();
  });

  it("uses no dash and passes the accessibility check", async () => {
    const { container } = await expectNoA11yViolations(<MembershipShop locale="en" fee={{ ...FEE }} go={jest.fn()} />);
    expect(container.textContent ?? "").not.toMatch(/[—–]/);
  });
});
