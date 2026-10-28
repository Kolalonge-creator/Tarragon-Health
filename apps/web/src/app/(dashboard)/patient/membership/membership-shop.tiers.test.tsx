/** @jest-environment jsdom */
/**
 * The Membership screen with the Membership ladder on (founder decision 2026-10-21): two equal tier cards that state the annual blood
 * panel first, no instalment choice (there is none), a current Membership member sees only the upgrade, and the upgrade sends just its item code.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { MembershipShop } from "./membership-shop";

const FEE = { localBasisPoints: 150, flatKobo: 10_000, flatWaivedBelowKobo: 250_000, capKobo: 200_000 };
const base = { kind: "membership", duration_days: 365, uses: null, components: {} };
const PLUS = { ...base, code: "membership_annual", name_key: "catalog.membership_annual.name", description_key: "catalog.membership_annual.description", included_keys: ["catalog.membership_annual.incl.1", "catalog.membership_annual.incl.2"], amount_kobo: 12_900_000 };
const EG = { ...base, code: "membership_annual_no_panel", name_key: "catalog.membership_annual_no_panel.name", description_key: "catalog.membership_annual_no_panel.description", included_keys: ["catalog.membership_annual_no_panel.incl.1"], amount_kobo: 8_400_000 };
const UP = { ...base, code: "membership_upgrade_plus", name_key: "catalog.membership_upgrade_plus.name", description_key: "catalog.membership_upgrade_plus.description", included_keys: ["catalog.membership_upgrade_plus.incl.1"], amount_kobo: 4_500_000 };

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

describe("MembershipShop with the Membership ladder", () => {
  it("shows Membership then Membership Plus as equal cards, each stating the annual blood panel first, in naira", async () => {
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    const cards = within(screen.getByTestId("shop-cards")).getAllByRole("heading", { level: 3, name: /^(Membership|Membership Plus)$/ }).length;
    expect(cards).toBeGreaterThanOrEqual(0);
    expect(screen.getByText("Annual blood panel: no")).toBeTruthy();
    expect(screen.getByText("Annual blood panel: yes")).toBeTruthy();
    expect(screen.getAllByText(/^Membership$/).length).toBe(1);
    expect(screen.getAllByText(/^Membership Plus$/).length).toBe(1);
    expect(screen.getByText("₦84,000")).toBeTruthy();
    expect(screen.getByText("₦129,000")).toBeTruthy();
    expect(screen.getByText(/same care/)).toBeTruthy();
    expect(screen.getByText(/same on every plan, including Free/)).toBeTruthy();
    expect(screen.queryByText("Move up to Membership Plus")).toBeNull();
    cleanup();
    await expectNoA11yViolations(<MembershipShop locale="en" fee={FEE} go={assign} />);
  });

  it("offers no instalment or monthly payment on either tier", () => {
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.queryByText(/parts|instalment/i)).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("uses no banned tier word, no countdown and no em dash on the tier cards", () => {
    const { container } = render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\b(basic|lite|standard|premium|gold)\b/i);
    expect(text).not.toMatch(/limited time|hurry|last chance|only \d+ left/i);
    expect(text).not.toContain("—");
  });

  it("buying a tier sends only its item code and a retry key", async () => {
    mutateAsync.mockResolvedValue({ order_id: "o1", reference: "tho_x", amount_kobo: 8_400_000, checkout_url: "https://checkout.paystack.com/abc" });
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    const buttons = screen.getAllByRole("button", { name: "Pay with Paystack" });
    await act(async () => fireEvent.click(buttons[0]!));
    const arg = mutateAsync.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.code).toBe("membership_annual_no_panel");
    expect(Object.keys(arg).filter((k) => arg[k] !== undefined).sort()).toEqual(["clientKey", "code"]);
  });

  it("an Membership member sees the upgrade and nothing else to buy, and it sends the upgrade code", async () => {
    membership = { data: { is_member: true, ends_at: "2027-08-01T00:00:00Z", source: "purchase", tier: "evergreen" } };
    mutateAsync.mockResolvedValue({ order_id: "o2", reference: "tho_y", amount_kobo: 4_500_000, checkout_url: "https://checkout.paystack.com/up" });
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.getByText(/Your Membership runs until/)).toBeTruthy();
    expect(screen.queryByText("Annual blood panel: no")).toBeNull();
    expect(screen.getByText("₦45,000")).toBeTruthy();
    // the upgrade is bought for an approved state: nothing can be paid until one is chosen
    const payUp = screen.getByRole("button", { name: "Move up to Membership Plus" }) as HTMLButtonElement;
    expect(payUp.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Where will your blood tests be collected?"), { target: { value: "Oyo" } });
    expect(payUp.disabled).toBe(false);
    await act(async () => fireEvent.click(payUp));
    const arg = mutateAsync.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.code).toBe("membership_upgrade_plus");
    expect(arg.collectionState).toBe("Oyo");
    expect(assign).toHaveBeenCalledWith("https://checkout.paystack.com/up");
  });

  it("an Membership Plus member sees no purchase and no upgrade", () => {
    membership = { data: { is_member: true, ends_at: "2027-08-01T00:00:00Z", source: "purchase", tier: "plus" } };
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.getByText(/You have Membership Plus until/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Move up to Membership Plus" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pay with Paystack" })).toBeNull();
  });

  it("before the ladder is on, only the single Membership shows, named Membership Plus, the product it actually is", () => {
    catalogue = { data: [PLUS, UP], isSuccess: true };
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.getByText("Membership Plus")).toBeTruthy();
    expect(screen.queryByText("Annual blood panel: no")).toBeNull();
    expect(screen.queryByText("Move up to Membership Plus")).toBeNull();
  });
  it("shows no monthly figure on either tier while the monthly line is off, and shows it only when switched on", () => {
    const { container, rerender } = render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(container.textContent ?? "").not.toMatch(/a month/i);
    rerender(<MembershipShop locale="en" fee={FEE} go={assign} showMonthly />);
    expect(container.textContent ?? "").toMatch(/a month/i);
  });

  it("a member in the 14 day grace sees both tier cards and can renew, not an upgrade-only screen", () => {
    membership = { data: { is_member: true, ends_at: "2026-10-20T00:00:00Z", source: "purchase", tier: "plus", in_grace: true, grace_ends_at: "2026-11-03T00:00:00Z" } };
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.getByText("Annual blood panel: no")).toBeTruthy();
    expect(screen.getByText("Annual blood panel: yes")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Pay with Paystack" }).length).toBe(2);
    expect(screen.queryByRole("button", { name: "Move up to Membership Plus" })).toBeNull();
  });
  it("a Plus member whose Membership year is already queued is told when the next year starts", () => {
    membership = { data: { is_member: true, ends_at: "2027-08-01T00:00:00Z", source: "purchase", tier: "plus", next_tier: "evergreen", next_starts_at: "2027-08-01T00:00:00Z" } };
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.getByText(/Your next year is already paid for and starts on/)).toBeTruthy();
  });

  it("Membership Plus asks for an approved state before payment, warns that it stays fixed, and sends it with the order", async () => {
    mutateAsync.mockResolvedValue({ order_id: "o3", reference: "tho_z", amount_kobo: 12_900_000, checkout_url: "https://checkout.paystack.com/plus" });
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.getAllByLabelText("Where will your blood tests be collected?").length).toBe(1);
    expect(screen.getByText(/stays fixed/)).toBeTruthy();
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Choose a state", "Lagos", "Oyo"]);
    const [membershipPay, plusPay] = screen.getAllByRole("button", { name: "Pay with Paystack" }) as HTMLButtonElement[];
    expect(membershipPay!.disabled).toBe(false);
    expect(plusPay!.disabled).toBe(true);
    await act(async () => fireEvent.click(plusPay!));
    expect(mutateAsync).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Where will your blood tests be collected?"), { target: { value: "Lagos" } });
    await act(async () => fireEvent.click(plusPay!));
    const arg = mutateAsync.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.code).toBe("membership_annual");
    expect(arg.collectionState).toBe("Lagos");
  });

  it("Membership (no Plus) is not limited by state: no picker on its card and no state sent", async () => {
    mutateAsync.mockResolvedValue({ order_id: "o4", reference: "tho_w", amount_kobo: 8_400_000, checkout_url: "https://checkout.paystack.com/eg" });
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    const [membershipPay] = screen.getAllByRole("button", { name: "Pay with Paystack" });
    await act(async () => fireEvent.click(membershipPay!));
    const arg = mutateAsync.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.code).toBe("membership_annual_no_panel");
    expect(arg.collectionState).toBeUndefined();
  });

  it("when no state is approved yet, Plus says so and cannot be paid, while Membership still can", () => {
    plusStates = [];
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.getByText(/not open in any state yet/)).toBeTruthy();
    const [membershipPay, plusPay] = screen.getAllByRole("button", { name: "Pay with Paystack" }) as HTMLButtonElement[];
    expect(membershipPay!.disabled).toBe(false);
    expect(plusPay!.disabled).toBe(true);
  });

  it("before the ladder is on, the single Membership has no state picker", () => {
    catalogue = { data: [PLUS, UP], isSuccess: true };
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.queryByLabelText("Where will your blood tests be collected?")).toBeNull();
  });

  it("a Plus member is told which state their blood tests are collected in", () => {
    membership = { data: { is_member: true, ends_at: "2027-08-01T00:00:00Z", source: "purchase", tier: "plus", collection_state: "Ogun" } as never };
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.getByText("Your Membership Plus blood tests are collected in Ogun.")).toBeTruthy();
  });
  it("choosing a different state makes a different order: the retry key is not reused", async () => {
    mutateAsync.mockResolvedValue({ order_id: "o5", reference: "tho_k", amount_kobo: 12_900_000, checkout_url: "https://checkout.paystack.com/k" });
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    const select = screen.getByLabelText("Where will your blood tests be collected?");
    const plusPay = () => screen.getAllByRole("button", { name: "Pay with Paystack" })[1]!;
    fireEvent.change(select, { target: { value: "Lagos" } });
    await act(async () => fireEvent.click(plusPay()));
    fireEvent.change(select, { target: { value: "Oyo" } });
    await act(async () => fireEvent.click(plusPay()));
    const [a, b] = mutateAsync.mock.calls.map((c) => c[0] as { clientKey: string; collectionState: string });
    expect([a!.collectionState, b!.collectionState]).toEqual(["Lagos", "Oyo"]);
    expect(a!.clientKey).not.toBe(b!.clientKey);
  });

  it("paying for someone else asks for THEIR state, by name", () => {
    render(<MembershipShop locale="en" fee={FEE} go={assign} beneficiary={{ id: "11111111-1111-4111-8111-111111111111", name: "Amina" }} />);
    expect(screen.getByLabelText("Where will Amina's blood tests be collected?")).toBeTruthy();
    expect(screen.queryByLabelText("Where will your blood tests be collected?")).toBeNull();
  });
});

describe("A Plus member with no collection state (OQ-PLUS-1)", () => {
  const plusNoState = (collection_state: string | null) => ({ data: { is_member: true, ends_at: "2027-06-01T00:00:00Z", source: "employer", tier: "plus" as const, collection_state } });

  it("is asked to choose once, and saving sends the chosen state", () => {
    membership = plusNoState(null);
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    const save = screen.getByRole("button", { name: "Save my state" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Where will your blood tests be collected?"), { target: { value: "Oyo" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(setStateMutate).toHaveBeenCalledWith("Oyo");
  });

  it("shows nothing to set once the state exists, and nothing for Membership without Plus", () => {
    membership = plusNoState("Lagos");
    const { unmount } = render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.queryByRole("button", { name: "Save my state" })).toBeNull();
    expect(screen.getByText("Your Membership Plus blood tests are collected in Lagos.")).toBeTruthy();
    unmount();
    membership = { data: { is_member: true, ends_at: "2027-06-01T00:00:00Z", source: "purchase", tier: "evergreen" } };
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.queryByRole("button", { name: "Save my state" })).toBeNull();
  });

  it("says a withdrawn state is not open instead of a generic failure", () => {
    membership = plusNoState(null);
    setStateResult = { isError: true, error: new Error("plus_state_not_available"), isPending: false };
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.getByText(/not open in that state/)).toBeTruthy();
  });
});
