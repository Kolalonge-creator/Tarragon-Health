/** @jest-environment jsdom */
/**
 * S71: sponsor-paid items (19.5), the itemised checkout (19.7) and the foreign-card line (19.4).
 * Acceptance: a sponsor-paid item never shows a payment step. The itemised lines add up. Scanned with axe.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { parseQuote } from "@tarragon/commerce";
import { expectNoA11yViolations } from "@/test/a11y";
import { MembershipShop } from "./membership-shop";

const FEE = { localBasisPoints: 150, flatKobo: 10_000, flatWaivedBelowKobo: 250_000, capKobo: 200_000, internationalBasisPoints: 390, internationalFlatKobo: 10_000 };
const ITEM = {
  code: "proof_consult", kind: "consultation", name_key: "catalog.consultation_single.name", description_key: "catalog.consultation_single.description",
  included_keys: ["catalog.consultation_single.incl.1"], duration_days: null, uses: 1, amount_kobo: 500_000, components: { clinician_fee: 300_000, tarragon_service_fee: 200_000 },
};
const line = (rule: string, amount: number, running: number) => ({ rule, label_key: `quote.line.${rule}`, amount_kobo: amount, running_kobo: running, applied: true, reason_key: null });
const plain = parseQuote({ item_code: "proof_consult", list_kobo: 500_000, sponsor_share_kobo: 0, amount_due_kobo: 500_000, lines: [line("list", 500_000, 500_000)] });
const covered = parseQuote({
  item_code: "proof_consult", list_kobo: 500_000, sponsor_share_kobo: 500_000, amount_due_kobo: 0, sponsor_name: "Acme Ltd",
  lines: [line("list", 500_000, 500_000), line("sponsor", -500_000, 0)],
});
const part = parseQuote({
  item_code: "proof_consult", list_kobo: 500_000, sponsor_share_kobo: 200_000, amount_due_kobo: 300_000, sponsor_name: "Acme Ltd",
  lines: [line("list", 500_000, 500_000), line("sponsor", -200_000, 300_000)],
});

let catalogue: { data: unknown[]; isSuccess: boolean };
let quote: { data: unknown };
const mutateAsync = jest.fn();
jest.mock("@/lib/queries/commerce", () => {
  const actual = jest.requireActual("@/lib/queries/commerce");
  return {
    ...actual,
    useCatalogue: () => catalogue,
    useMyMembership: () => ({ data: { is_member: false, ends_at: null, source: null } }),
    useMyOrders: () => ({ data: [] }),
    useStartCheckout: () => ({ mutateAsync, isPending: false }),
    useQuote: () => quote,
  };
});
jest.mock("@/lib/queries/care-access", () => ({ useSponsorableProfiles: () => ({ data: [] }) }));

const go = jest.fn();
beforeEach(() => {
  catalogue = { data: [ITEM], isSuccess: true };
  quote = { data: plain };
  mutateAsync.mockReset();
  go.mockReset();
});

describe("sponsor-paid items never show a payment step (S71, 19.5)", () => {
  it("says who covers it, and shows no price lines, no processing fee, no discount box and no pay button", async () => {
    quote = { data: covered };
    await expectNoA11yViolations(<MembershipShop locale="en" fee={FEE} go={go} />);
    expect(screen.getByText("Covered by Acme Ltd")).toBeTruthy();
    expect(screen.getByText(/Nothing to pay/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pay with Paystack" })).toBeNull();
    expect(screen.queryByText(/Payment processing/)).toBeNull();
    expect(screen.queryByText("Total to pay")).toBeNull();
    expect(screen.queryByText("Payment fee")).toBeNull();
    expect(screen.queryByLabelText("Discount code")).toBeNull();
    expect(screen.getByRole("button", { name: "Use this cover" })).toBeTruthy();
  });

  it("taking the cover sends the total 0 the person saw, opens nothing, and says it is covered", async () => {
    quote = { data: covered };
    mutateAsync.mockResolvedValue({ covered: true, order_id: "o2", reference: "spo_0123456789abcdef0123456789abcdef", sponsor_name: "Acme Ltd" });
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Use this cover" }));
    });
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ code: "proof_consult", expectedAmountKobo: 0 }));
    expect(go).not.toHaveBeenCalled();
    expect(screen.getByText("This is covered")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pay with Paystack" })).toBeNull();
  });

  it("when the cover runs out the quote is the ordinary price and the ordinary pay button returns, with a plain explanation", () => {
    quote = { data: parseQuote({ item_code: "proof_consult", list_kobo: 500_000, sponsor_share_kobo: 0, amount_due_kobo: 500_000, sponsor_budget_short: true, lines: [line("list", 500_000, 500_000)] }) };
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    expect(screen.getByText(/cover for this has run out/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pay with Paystack" })).toBeTruthy();
  });

  it("a part-covered item shows the sponsor's share and still asks for the remainder through the ordinary payment", () => {
    quote = { data: part };
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    expect(screen.getByText(/Acme Ltd pays ₦2,000 of this/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pay with Paystack" })).toBeTruthy();
  });
});

describe("itemised checkout (S71, 19.7)", () => {
  it("names the clinician fee, Tarragon's fee and the processing estimate in plain words, and the total is their sum", async () => {
    await expectNoA11yViolations(<MembershipShop locale="en" fee={FEE} go={go} />);
    const section = screen.getByRole("region", { name: "What you are paying for" });
    const rows = within(section).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(rows[0]).toMatch(/^Clinician fee₦3,000$/);
    expect(rows[1]).toMatch(/^Tarragon service fee₦2,000$/);
    expect(rows[2]).toMatch(/^Payment processing \(estimate\)about ₦/);
    const fee = Number((rows[2] ?? "").replace(/^.*about ₦/, "").replace(/,/g, ""));
    const total = Number((within(section).getAllByText(/^about ₦/, { selector: "span" }).at(-1)?.textContent ?? "").replace(/[^0-9.,]/g, "").replace(/,/g, ""));
    expect(total).toBe(3000 + 2000 + fee);
    expect(screen.getByText(/goes to Paystack, not to Tarragon/)).toBeTruthy();
  });

  it("an item with no recorded split is one honest price line, never an invented split", () => {
    catalogue = { data: [{ ...ITEM, components: {} }], isSuccess: true };
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    const section = screen.getByRole("region", { name: "What you are paying for" });
    expect(within(section).queryByText("Clinician fee")).toBeNull();
    expect(within(section).getByText("Price")).toBeTruthy();
  });
});

describe("paying for someone from abroad (S71, 19.4)", () => {
  it("shows the higher processing estimate for a card issued outside Nigeria, labelled as an estimate", () => {
    catalogue = { data: [{ ...ITEM, code: "membership_annual", kind: "membership", name_key: "catalog.membership_annual.name", duration_days: 365, uses: null, components: {} }], isSuccess: true };
    render(<MembershipShop locale="en" fee={FEE} go={go} beneficiary={{ id: "b1", name: "Ada" }} />);
    expect(screen.getByText(/Paying from abroad\? Cards issued outside Nigeria cost more to process/)).toBeTruthy();
    expect(screen.getByText(/the processing fee is about ₦[\d,]+ and the total about ₦[\d,]+/)).toBeTruthy();
  });
  it("does not show that line to someone paying for themselves", () => {
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    expect(screen.queryByText(/Paying from abroad/)).toBeNull();
    expect(screen.getByText(/If you pay with a card issued outside Nigeria/)).toBeTruthy();
  });
});

afterEach(() => cleanup());
