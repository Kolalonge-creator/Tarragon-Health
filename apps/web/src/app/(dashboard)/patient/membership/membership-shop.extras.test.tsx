/** @jest-environment jsdom */
/**
 * S72: Health Points at checkout (19.9) and who may ask for a refund (19.8).
 * Points lower only Tarragon's own fee, for this one payment, and only when the person chooses. A supporter-paid order has no refund button for the person it is for.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { parseQuote } from "@tarragon/commerce";
import { expectNoA11yViolations } from "@/test/a11y";
import { MembershipShop } from "./membership-shop";

const FEE = { localBasisPoints: 150, flatKobo: 10_000, flatWaivedBelowKobo: 250_000, capKobo: 200_000, internationalBasisPoints: 390, internationalFlatKobo: 10_000 };
const ITEM = {
  code: "proof_consult", kind: "consultation", name_key: "catalog.consultation_single.name", description_key: "catalog.consultation_single.description",
  included_keys: ["catalog.consultation_single.incl.1"], duration_days: null, uses: 1, amount_kobo: 500_000, components: { partner_fee: 300_000, tarragon_service_fee: 200_000 },
};
const line = (rule: string, amount: number, running: number, applied = true, reason: string | null = null) => ({ rule, label_key: `quote.line.${rule}`, amount_kobo: amount, running_kobo: running, applied, reason_key: reason });
const plain = parseQuote({ item_code: "proof_consult", list_kobo: 500_000, amount_due_kobo: 500_000, lines: [line("list", 500_000, 500_000)] });
const withPoints = parseQuote({
  item_code: "proof_consult", list_kobo: 500_000, amount_due_kobo: 475_000, points_applied: 500, points_reduction_kobo: 25_000,
  lines: [line("list", 500_000, 500_000), line("points", -25_000, 475_000)],
});
const pointsOff = parseQuote({
  item_code: "proof_consult", list_kobo: 500_000, amount_due_kobo: 500_000,
  lines: [line("list", 500_000, 500_000), line("points", 0, 500_000, false, "quote.reason.points_off")],
});

let quotes: { plain: unknown; points: unknown };
let orders: unknown[];
const mutateAsync = jest.fn();
jest.mock("@/lib/queries/commerce", () => {
  const actual = jest.requireActual("@/lib/queries/commerce");
  return {
    ...actual,
    useCatalogue: () => ({ data: [ITEM], isSuccess: true }),
    useMyMembership: () => ({ data: { is_member: false, ends_at: null, source: null } }),
    useMyOrders: () => ({ data: orders }),
    useStartCheckout: () => ({ mutateAsync, isPending: false }),
    useQuote: (input: { usePoints?: boolean }) => ({ data: input.usePoints ? quotes.points : quotes.plain }),
  };
});
jest.mock("@/lib/queries/care-access", () => ({ useSponsorableProfiles: () => ({ data: [] }) }));
jest.mock("@/lib/queries/order-refunds", () => ({ useRequestOrderRefund: () => ({ mutateAsync: jest.fn(), isPending: false }) }));

const go = jest.fn();
beforeEach(() => {
  quotes = { plain, points: pointsOff };
  orders = [];
  mutateAsync.mockReset();
  go.mockReset();
});
afterEach(cleanup);

describe("Health Points at checkout (S72, 19.9)", () => {
  it("shows no points choice when points cannot be used (off, none, or not for this item)", () => {
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    expect(screen.queryByLabelText(/Health Points/)).toBeNull();
  });

  it("offers the choice only when the database says points would apply, and says they lower only Tarragon's own fee for this one payment", async () => {
    quotes = { plain, points: withPoints };
    await expectNoA11yViolations(<MembershipShop locale="en" fee={FEE} go={go} />);
    const box = screen.getByLabelText(/Use my Health Points on Tarragon's own fee/) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(screen.getByText(/Using 500 points takes ₦250 off this payment/)).toBeTruthy();
    expect(screen.getByText(/never lower a clinician's or a partner's fee/)).toBeTruthy();
  });

  it("is off until the person chooses; paying without the choice sends no points and the ordinary total", async () => {
    quotes = { plain, points: withPoints };
    mutateAsync.mockResolvedValue({ order_id: "o1", reference: "tho_x", amount_kobo: 500_000, checkout_url: "https://checkout.example/x" });
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Pay with Paystack" })); });
    const sent = mutateAsync.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent["usePoints"]).toBeUndefined();
    expect(sent["expectedAmountKobo"]).toBe(500_000);
  });

  it("choosing it sends the points wish and the lower total the person saw", async () => {
    quotes = { plain, points: withPoints };
    mutateAsync.mockResolvedValue({ order_id: "o1", reference: "tho_x", amount_kobo: 475_000, checkout_url: "https://checkout.example/x" });
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    fireEvent.click(screen.getByLabelText(/Use my Health Points on Tarragon's own fee/));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Pay with Paystack" })); });
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ usePoints: true, expectedAmountKobo: 475_000 }));
  });
});

describe("refunds on the order history (S72, 19.8)", () => {
  const paid = { order_id: "o1", state: "paid", amount_kobo: 500_000, fee_kobo: 7_500, total_kobo: 507_500, code: "proof_consult", name_key: "catalog.consultation_single.name", created_at: "2026-10-01T10:00:00Z", paid_at: "2026-10-01T10:05:00Z", sponsor_share_kobo: 0, sponsor_name: null };

  it("the buyer of a paid order can ask for a refund", () => {
    orders = [{ ...paid, is_buyer: true, refund_state: null }];
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    expect(screen.getByRole("button", { name: "Request refund" })).toBeTruthy();
  });

  it("the person a supporter paid for is not offered a refund button", () => {
    orders = [{ ...paid, is_buyer: false, refund_state: null }];
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    expect(screen.queryByRole("button", { name: "Request refund" })).toBeNull();
  });

  it("once a refund is asked for the button goes and the state is said in words", () => {
    orders = [{ ...paid, is_buyer: true, refund_state: "pending" }];
    render(<MembershipShop locale="en" fee={FEE} go={go} />);
    expect(screen.queryByRole("button", { name: "Request refund" })).toBeNull();
    expect(screen.getByText("Refund asked for")).toBeTruthy();
  });
});
