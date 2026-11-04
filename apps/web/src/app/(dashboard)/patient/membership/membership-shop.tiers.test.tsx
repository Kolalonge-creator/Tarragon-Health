/** @jest-environment jsdom */
/**
 * The Membership screen after T2-01 (2026-11-04): Membership Plus and the upgrade to it are retired. Only the one Membership is offered,
 * even when a stale catalogue still returns the retired items; there is no state picker on any purchase; a Plus year bought earlier is
 * still described (its end date, its collection state, and the one-time state setup), never sold or upsold.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { t } from "@tarragon/i18n";
import { formatPatientDate } from "@/lib/format-date";
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

const PAY = () => t("shop.pay", "en");
const STATE_LABEL = () => t("shop.plus.state.label", "en");

describe("MembershipShop offers only the Membership (T2-01)", () => {
  it("a Free person sees exactly one card, the Membership, even when the catalogue still returns Plus and the upgrade", async () => {
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    const cards = screen.getByTestId("shop-cards");
    expect(within(cards).getAllByRole("button", { name: PAY() }).length).toBe(1);
    expect(within(cards).getByText(t("catalog.membership_annual_no_panel.name", "en"))).toBeTruthy();
    expect(within(cards).queryByText(t("shop.tier.evergreen_plus.name", "en"))).toBeNull();
    expect(within(cards).queryByText(t("catalog.membership_annual.name", "en"))).toBeNull();
    expect(screen.queryByText(t("shop.tier.panel_yes", "en"))).toBeNull();
    expect(screen.queryByRole("button", { name: t("shop.tier.upgrade.pay", "en") })).toBeNull();
    expect(screen.queryByTestId(/^panel-tests-/)).toBeNull();
    expect(screen.getByText("₦100,000")).toBeTruthy();
    expect(screen.queryByText("₦120,000")).toBeNull();
    cleanup();
    await expectNoA11yViolations(<MembershipShop locale="en" fee={FEE} go={assign} />);
  });

  it("there is no state picker anywhere on the purchase, for yourself or for someone else", () => {
    const { unmount } = render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.queryByLabelText(STATE_LABEL())).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    unmount();
    render(<MembershipShop locale="en" fee={FEE} go={assign} beneficiary={{ id: "11111111-1111-4111-8111-111111111111", name: "Amina" }} />);
    expect(screen.queryByLabelText(t("shop.plus.state.label_for", "en", { name: "Amina" }))).toBeNull();
    expect(screen.getAllByRole("button", { name: PAY() }).length).toBe(1);
  });

  it("offers no instalment or monthly payment", () => {
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.queryByText(/parts|instalment/i)).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("uses no banned tier word, no countdown and no em dash", () => {
    const { container } = render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\b(basic|lite|standard|premium|gold)\b/i);
    expect(text).not.toMatch(/limited time|hurry|last chance|only \d+ left/i);
    expect(text).not.toContain("\u2014");
  });

  it("buying sends only the Membership code and a retry key, never a collection state", async () => {
    mutateAsync.mockResolvedValue({ order_id: "o1", reference: "tho_x", amount_kobo: 10_000_000, checkout_url: "https://checkout.paystack.com/abc" });
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: PAY() })));
    const arg = mutateAsync.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.code).toBe("membership_annual_no_panel");
    expect(Object.keys(arg).filter((k) => arg[k] !== undefined).sort()).toEqual(["clientKey", "code"]);
    expect(assign).toHaveBeenCalledWith("https://checkout.paystack.com/abc");
  });

  it("a current Membership member is told their year and is offered nothing to buy: no upgrade", () => {
    membership = { data: { is_member: true, ends_at: "2027-08-01T00:00:00Z", source: "purchase", tier: "evergreen" } };
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.getByText(t("shop.tier.you_have_evergreen", "en", { date: formatPatientDate("2027-08-01T00:00:00Z") }))).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("shop.tier.upgrade.pay", "en") })).toBeNull();
    expect(screen.queryByRole("button", { name: PAY() })).toBeNull();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("a member who bought Membership Plus earlier still sees their Plus year described, and nothing to buy", () => {
    membership = { data: { is_member: true, ends_at: "2027-08-01T00:00:00Z", source: "purchase", tier: "plus" } };
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.getByText(t("shop.tier.you_have_plus", "en", { date: formatPatientDate("2027-08-01T00:00:00Z") }))).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("shop.tier.upgrade.pay", "en") })).toBeNull();
    expect(screen.queryByRole("button", { name: PAY() })).toBeNull();
  });

  it("a Plus holder in the grace can renew only the Membership, not Plus", () => {
    membership = { data: { is_member: true, ends_at: "2026-10-20T00:00:00Z", source: "purchase", tier: "plus", in_grace: true, grace_ends_at: "2026-11-03T00:00:00Z" } };
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.getAllByRole("button", { name: PAY() }).length).toBe(1);
    expect(screen.queryByText(t("shop.tier.panel_yes", "en"))).toBeNull();
    expect(screen.queryByLabelText(STATE_LABEL())).toBeNull();
  });

  it("with only the retired items left in a stale catalogue, nothing is offered for sale", () => {
    catalogue = { data: [PLUS, UP], isSuccess: true };
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.queryByRole("button", { name: PAY() })).toBeNull();
    expect(screen.queryByText(t("shop.tier.evergreen_plus.name", "en"))).toBeNull();
  });

  it("shows no monthly figure while the monthly line is off, and shows it only when switched on", () => {
    const { container, rerender } = render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(container.textContent ?? "").not.toMatch(/a month/i);
    rerender(<MembershipShop locale="en" fee={FEE} go={assign} showMonthly />);
    expect(container.textContent ?? "").toMatch(/a month/i);
  });

  it("a Plus member whose next year is already queued is told when it starts", () => {
    membership = { data: { is_member: true, ends_at: "2027-08-01T00:00:00Z", source: "purchase", tier: "plus", next_tier: "evergreen", next_starts_at: "2027-08-01T00:00:00Z" } };
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.getByText(t("shop.tier.next_year", "en", { date: formatPatientDate("2027-08-01T00:00:00Z") }))).toBeTruthy();
  });

  it("a Plus member is told which state their blood tests are collected in", () => {
    membership = { data: { is_member: true, ends_at: "2027-08-01T00:00:00Z", source: "purchase", tier: "plus", collection_state: "Ogun" } as never };
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.getByText(t("shop.plus.state.yours", "en", { state: "Ogun" }))).toBeTruthy();
  });
});

describe("A Plus member with no collection state (OQ-PLUS-1), an existing Plus year only", () => {
  const plusNoState = (collection_state: string | null) => ({ data: { is_member: true, ends_at: "2027-06-01T00:00:00Z", source: "employer", tier: "plus" as const, collection_state } });
  const SAVE = () => t("shop.plus.state.set_button", "en");

  it("is asked to choose once, and saving sends the chosen state", () => {
    membership = plusNoState(null);
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    const save = screen.getByRole("button", { name: SAVE() }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(STATE_LABEL()), { target: { value: "Oyo" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(setStateMutate).toHaveBeenCalledWith("Oyo");
  });

  it("shows nothing to set once the state exists, and nothing for a Membership year", () => {
    membership = plusNoState("Lagos");
    const { unmount } = render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.queryByRole("button", { name: SAVE() })).toBeNull();
    unmount();
    membership = { data: { is_member: true, ends_at: "2027-06-01T00:00:00Z", source: "purchase", tier: "evergreen" } };
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.queryByRole("button", { name: SAVE() })).toBeNull();
  });

  it("says a withdrawn state is not open instead of a generic failure", () => {
    membership = plusNoState(null);
    setStateResult = { isError: true, error: new Error("plus_state_not_available"), isPending: false };
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.getByText(t("shop.error.plus_state_not_available", "en"))).toBeTruthy();
  });
});
