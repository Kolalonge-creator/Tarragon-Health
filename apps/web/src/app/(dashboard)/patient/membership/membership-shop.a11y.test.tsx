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
  included_keys: ["catalog.membership_annual.incl.1", "catalog.membership_annual.incl.2"], duration_days: 365, uses: null, amount_kobo: 12_000_000, components: {},
};

let catalogue: { data: unknown[]; isSuccess: boolean };
let membership: { data: { is_member: boolean; ends_at: string | null; source: string | null } };
let orders: { data: unknown[] };
let quote: { data: unknown };
const useQuoteSpy = jest.fn();
const mutateAsync = jest.fn();
jest.mock("@/lib/queries/commerce", () => {
  const actual = jest.requireActual("@/lib/queries/commerce");
  return {
    ...actual,
    useCatalogue: () => catalogue,
    useMyMembership: () => membership,
    useMyOrders: () => orders,
    useStartCheckout: () => ({ mutateAsync, isPending: false }),
    useQuote: (input: unknown) => { useQuoteSpy(input); return quote; },
  };
});

let lovedOnes: { data: { id: string; full_name: string | null }[] };
jest.mock("@/lib/queries/care-access", () => ({ useSponsorableProfiles: () => lovedOnes }));

const assign = jest.fn();
beforeEach(() => {
  lovedOnes = { data: [] };
  catalogue = { data: [ITEM], isSuccess: true };
  membership = { data: { is_member: false, ends_at: null, source: null } };
  orders = { data: [] };
  quote = { data: null };
  useQuoteSpy.mockReset();
  mutateAsync.mockReset();
  assign.mockReset();
});

describe("MembershipShop", () => {
  it("shows the item, what is included, the price and an estimated fee labelled as an estimate", async () => {
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.getByText("Tarragon Membership")).toBeTruthy();
    expect(screen.getByText(/A video call with your care team every month/)).toBeTruthy();
    expect(screen.getByText("₦120,000")).toBeTruthy();
    expect(screen.getAllByText(/about ₦/).length).toBe(2);
    expect(screen.getByText(/estimate/i)).toBeTruthy();
    expect(screen.getByText(/does not renew by itself/)).toBeTruthy();
    cleanup();
    await expectNoA11yViolations(<MembershipShop locale="en" fee={FEE} go={assign} />);
  });

  it("sends only the item code and a retry key, then opens Paystack", async () => {
    mutateAsync.mockResolvedValue({ order_id: "o1", reference: "tho_x", amount_kobo: 12_000_000, checkout_url: "https://checkout.paystack.com/abc" });
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pay with Paystack" })));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    const arg = mutateAsync.mock.calls[0]![0] as Record<string, unknown>;
    // a purchase for oneself passes `beneficiary: undefined`; only defined fields are sent over the wire
    expect(Object.keys(arg).filter((k) => arg[k] !== undefined).sort()).toEqual(["clientKey", "code"]);
    expect(arg.code).toBe("membership_annual");
    expect(assign).toHaveBeenCalledWith("https://checkout.paystack.com/abc");
  });

  it("lets the patient pay for someone they care for and sends who it is for, only when chosen", async () => {
    lovedOnes = { data: [{ id: "p-mum", full_name: "Mum" }] };
    mutateAsync.mockResolvedValue({ order_id: "o1", reference: "tho_x", amount_kobo: 12_000_000, checkout_url: "https://checkout.paystack.com/abc" });
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "p-mum" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pay with Paystack" })));
    expect(mutateAsync.mock.calls[0]![0]).toMatchObject({ code: "membership_annual", beneficiary: "p-mum" });
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

  it("lists payments with the amount actually charged and their state", () => {
    orders = { data: [{ order_id: "o1", state: "paid", amount_kobo: 500_000, fee_kobo: 150, total_kobo: 500_150, code: "x_item", name_key: "catalog.bp_care_pack_3m.name", created_at: "2026-10-06T10:00:00Z", paid_at: "2026-10-06T10:01:00Z" }] };
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.getByText("₦5,001.50")).toBeTruthy();
    expect(screen.getByText("Paid")).toBeTruthy();
  });

  it("shows nothing for a copy key this build does not know, never the raw key", () => {
    catalogue = { data: [{ ...ITEM, name_key: "catalog.future.name", included_keys: ["catalog.future.incl.1"] }], isSuccess: true };
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.queryByText(/catalog\.future/)).toBeNull();
  });

  // S73: the price shown is the database's quote
  const line = (rule: string, amountKobo: number, runningKobo: number, extra: Record<string, unknown> = {}) => ({
    rule, labelKey: `quote.line.${rule}`, amountKobo, runningKobo, applied: true, reasonKey: null, ...extra,
  });
  const QUOTE = {
    itemCode: "membership_annual", listKobo: 10_000_000, amountDueKobo: 9_000_000, sponsorShareKobo: 0, discountKobo: 1_000_000, pointsApplied: 0,
    pointsReductionKobo: 0, discountCodeOk: true, rateLimited: false,
    lines: [line("list", 10_000_000, 10_000_000), line("discount_code", -1_000_000, 9_000_000)],
  };

  it("S73: shows the quote's price and each line of the explanation instead of the catalogue price", () => {
    quote = { data: QUOTE };
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    // S71 (19.7): the quote is laid out as the itemised checkout: the price, each reduction, the processing estimate, and a total that is their sum
    const section = screen.getByRole("region", { name: "What you are paying for" });
    expect(section.textContent).toMatch(/Price₦100,000/);
    expect(section.textContent).toMatch(/Discount code-₦10,000/);
    expect(section.textContent).toMatch(/Payment processing \(estimate\)about ₦/);
  });

  it("S73: sends the total it showed, so a changed price is refused instead of charged", async () => {
    quote = { data: QUOTE };
    mutateAsync.mockResolvedValue({ order_id: "o1", reference: "tho_x", amount_kobo: 9_000_000, checkout_url: "https://checkout.paystack.com/abc" });
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pay with Paystack" })));
    expect(mutateAsync.mock.calls[0]![0]).toMatchObject({ code: "membership_annual", expectedAmountKobo: 9_000_000 });
  });

  it("S73: applying a code asks for a new quote with it, and sends it with the order", async () => {
    mutateAsync.mockResolvedValue({ order_id: "o1", reference: "tho_x", amount_kobo: 9_000_000, checkout_url: "https://checkout.paystack.com/abc" });
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    fireEvent.change(screen.getByLabelText("Discount code"), { target: { value: "WELCOME26" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply code" }));
    expect(useQuoteSpy).toHaveBeenLastCalledWith(expect.objectContaining({ code: "membership_annual", discountCode: "WELCOME26" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pay with Paystack" })));
    expect(mutateAsync.mock.calls[0]![0]).toMatchObject({ discountCode: "WELCOME26" });
    fireEvent.click(screen.getByRole("button", { name: "Remove code" }));
    expect(useQuoteSpy).toHaveBeenLastCalledWith(expect.objectContaining({ discountCode: null }));
  });

  it("S73: a code that cannot be used is said so without saying why, and is not sent", async () => {
    quote = { data: { ...QUOTE, discountCodeOk: false, discountKobo: 0, amountDueKobo: 10_000_000, lines: [line("list", 10_000_000, 10_000_000), line("discount_code", 0, 10_000_000, { applied: false, reasonKey: "quote.reason.code_unusable" })] } };
    mutateAsync.mockResolvedValue({ order_id: "o1", reference: "tho_x", amount_kobo: 10_000_000, checkout_url: "https://checkout.paystack.com/abc" });
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    fireEvent.change(screen.getByLabelText("Discount code"), { target: { value: "NOPE1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply code" }));
    expect(screen.getByRole("status").textContent).toBe("This code cannot be used.");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pay with Paystack" })));
    const arg = mutateAsync.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.discountCode).toBeUndefined();
  });

  it("S73: links each item to its own what-is-included page", () => {
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    expect(screen.getByRole("link", { name: "See what is included" }).getAttribute("href")).toBe("/patient/membership/membership_annual");
  });

  // S29: pay for a loved one
  let confirm: jest.SpyInstance;
  beforeEach(() => {
    confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => confirm.mockRestore());

  it("when paying for someone, names them, sends their id with the code and key, and ignores the payer's own membership", async () => {
    membership = { data: { is_member: true, ends_at: "2027-01-01T00:00:00Z", source: "purchase" } };
    mutateAsync.mockResolvedValue({ order_id: "o1", reference: "tho_x", amount_kobo: 12_000_000, checkout_url: "https://checkout.paystack.com/abc" });
    render(<MembershipShop locale="en" fee={FEE} go={assign} beneficiary={{ id: "p-9", name: "Mama Eze" }} />);
    expect(screen.getByText("Paying for Mama Eze")).toBeTruthy();
    expect(screen.getByText(/You will not see any health information/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pay with Paystack" })));
    const arg = mutateAsync.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(arg).sort()).toEqual(["beneficiary", "clientKey", "code"]);
    expect(arg.beneficiary).toBe("p-9");
  });

  it("when paying for someone, names them and says what happens before any order is made, and a no creates nothing", async () => {
    confirm.mockReturnValue(false);
    render(<MembershipShop locale="en" fee={FEE} go={assign} beneficiary={{ id: "p-9", name: "Mama Eze" }} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pay with Paystack" })));
    expect(confirm).toHaveBeenCalledTimes(1);
    const text = String(confirm.mock.calls[0]![0]);
    expect(text).toMatch(/Pay for Mama Eze's Membership\?/);
    expect(text).toMatch(/asked to accept it, and you are refunded if they say no/);
    expect(text).toMatch(/will not see any health information/);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("paying for yourself asks for no extra confirmation", async () => {
    mutateAsync.mockResolvedValue({ order_id: "o1", reference: "tho_x", amount_kobo: 12_000_000, checkout_url: "https://checkout.paystack.com/abc" });
    render(<MembershipShop locale="en" fee={FEE} go={assign} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pay with Paystack" })));
    expect(confirm).not.toHaveBeenCalled();
    expect(mutateAsync).toHaveBeenCalled();
  });

  it("paying for someone else with anything but the yearly Membership is refused in plain words", async () => {
    mutateAsync.mockRejectedValue(new CheckoutError("gift_item_not_allowed"));
    render(<MembershipShop locale="en" fee={FEE} go={assign} beneficiary={{ id: "p-9", name: "Mama Eze" }} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pay with Paystack" })));
    expect(screen.getByRole("alert").textContent).toBe("Only the full yearly Membership can be paid for someone else.");
  });

  it("when paying for someone, an already-a-member refusal talks about them, not the payer", async () => {
    mutateAsync.mockRejectedValue(new CheckoutError("already_member"));
    render(<MembershipShop locale="en" fee={FEE} go={assign} beneficiary={{ id: "p-9", name: "Mama Eze" }} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pay with Paystack" })));
    expect(screen.getByRole("alert").textContent).toBe("They are already a member.");
  });

  it("a refusal because their Care Circle access ended is shown in plain words", async () => {
    mutateAsync.mockRejectedValue(new CheckoutError("order_beneficiary_not_allowed"));
    render(<MembershipShop locale="en" fee={FEE} go={assign} beneficiary={{ id: "p-9", name: "Mama Eze" }} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pay with Paystack" })));
    expect(screen.getByRole("alert").textContent).toMatch(/cannot pay for this person right now/);
  });
});
