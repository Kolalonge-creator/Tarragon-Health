/** @jest-environment jsdom */
/**
 * Patient dashboard 2.0, spec 15.1: the Free plan is shown beside the Membership for someone choosing for themselves, with the
 * same wording as the public pricing page, and never to a Member or while the membership read is still loading.
 */
/**
* placeholder (2026-11-04): Membership Plus and the upgrade to it are retired. Only the one Membership is offered,
 * even when a stale catalogue still returns the retired items; there is no state picker on any purchase; a Plus year bought earlier is
 * still described (its end date, its collection state, and the one-time state setup), never sold or upsold.
 */
import { render, screen, within } from "@testing-library/react";
import { MembershipShop } from "./membership-shop";

const FEE = { localBasisPoints: 150, flatKobo: 10_000, flatWaivedBelowKobo: 250_000, capKobo: 200_000 };
const base = { kind: "membership", duration_days: 365, uses: null, components: {} };
const PLUS = { ...base, code: "membership_annual", name_key: "catalog.membership_annual.name", description_key: "catalog.membership_annual.description", included_keys: ["catalog.membership_annual.incl.1", "catalog.membership_annual.incl.2"], amount_kobo: 12_000_000 };
const EG = { ...base, code: "membership_annual_no_panel", name_key: "catalog.membership_annual_no_panel.name", description_key: "catalog.membership_annual_no_panel.description", included_keys: ["catalog.membership_annual_no_panel.incl.1"], amount_kobo: 10_000_000 };
const UP = { ...base, code: "membership_upgrade_plus", name_key: "catalog.membership_upgrade_plus.name", description_key: "catalog.membership_upgrade_plus.description", included_keys: ["catalog.membership_upgrade_plus.incl.1"], amount_kobo: 4_000_000 };

let catalogue: { data: unknown[]; isSuccess: boolean };
let membership: { data: { is_member: boolean; ends_at: string | null; source: string | null; tier?: "evergreen" | "plus" | null; in_grace?: boolean; grace_ends_at?: string | null; next_tier?: "evergreen" | "plus" | null; next_starts_at?: string | null } };
const mutateAsync = jest.fn();
const setStateMutate = jest.fn();
let setStateResult: { isError: boolean; error: unknown; isPending: boolean } = { isError: false, error: null, isPending: false };
jest.mock("@/lib/queries/commerce", () => {
  const actual = jest.requireActual("@/lib/queries/commerce");
  return {
    ...actual,
    useCatalogue: () => catalogue,
    useMyMembership: () => membership,
    useMyOrders: () => ({ data: [] }),
    useStartCheckout: () => ({ mutateAsync, isPending: false }),
    useQuote: () => ({ data: null }),
    useSetMyPlusState: () => ({ mutate: setStateMutate, ...setStateResult }),
    useAutoRenewEnabled: () => ({ data: false }),
  };
});
let plusStates: { state: string; display_name: string }[] = [{ state: "Lagos", display_name: "Lagos" }, { state: "Oyo", display_name: "Oyo" }];
jest.mock("@/lib/queries/service-regions", () => ({ usePlusCollectionStates: () => ({ data: plusStates, isSuccess: true }) }));
jest.mock("@/components/join-waitlist", () => ({ JoinWaitlist: () => null }));
jest.mock("@/lib/queries/care-access", () => ({ useSponsorableProfiles: () => ({ data: [] }) }));
jest.mock("@/lib/queries/order-refunds", () => ({ useRefundPolicy: () => ({ data: undefined }), useRequestOrderRefund: () => ({ mutateAsync: jest.fn(), isPending: false }) }));

const assign = jest.fn();
beforeEach(() => {
  plusStates = [{ state: "Lagos", display_name: "Lagos" }, { state: "Oyo", display_name: "Oyo" }];
  catalogue = { data: [PLUS, EG, UP], isSuccess: true };
  membership = { data: { is_member: false, ends_at: null, source: null, tier: null } };
  mutateAsync.mockReset();
  assign.mockReset();
  setStateMutate.mockReset();
  setStateResult = { isError: false, error: null, isPending: false };
});


import { FREE_PLAN } from "@/lib/marketing/free-plan";

describe("MembershipShop Free plan card", () => {
  it("shows Free beside the Membership for a non-member", () => {
    membership = { ...membership, isSuccess: true } as typeof membership;
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    const free = screen.getByTestId("free-plan-card");
    expect(within(free).getByText(FREE_PLAN.name)).toBeTruthy();
    expect(within(free).getByText(FREE_PLAN.includes[0])).toBeTruthy();
    expect(within(free).getByText("This is your plan now.")).toBeTruthy();
  });

  it("does not show Free to a Member", () => {
    membership = { data: { is_member: true, ends_at: "2027-11-01", source: "purchase", tier: "evergreen" }, isSuccess: true } as typeof membership;
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.queryByTestId("free-plan-card")).toBeNull();
  });

  it("does not show Free before the membership read has answered", () => {
    membership = { data: undefined, isSuccess: false } as unknown as typeof membership;
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.queryByTestId("free-plan-card")).toBeNull();
  });

  it("does not show Free while buying for someone else", () => {
    membership = { ...membership, isSuccess: true } as typeof membership;
    render(<MembershipShop locale="en" fee={FEE} go={assign} beneficiary={{ id: "p-2", name: "Mama" }} />);
    expect(screen.queryByTestId("free-plan-card")).toBeNull();
  });
});
