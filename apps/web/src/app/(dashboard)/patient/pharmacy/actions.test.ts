/**
 * payForPharmacyOrder() must charge pharmacy_orders.payable_kobo (the
 * post-voucher-discount amount), not total_kobo (the pre-discount catalogue
 * price) — mirrors payForLabOrder's own contract in
 * ../lab-tests/actions.ts. Charging total_kobo would overcharge a patient
 * who applied a Care Voucher/discount to their pharmacy order and then paid
 * the remainder by card.
 */

jest.mock("next/headers", () => ({
  headers: async () => ({
    get: (key: string) => (key === "origin" ? "https://app.tarragonhealth.ng" : null),
  }),
}));

const redirect = jest.fn();
jest.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

const requireOwnedBookingOrder = jest.fn();
jest.mock("@/lib/billing/booking-ownership", () => ({
  requireOwnedBookingOrder: (...args: unknown[]) => requireOwnedBookingOrder(...args),
}));

const initiateBookingCheckout = jest.fn();
jest.mock("@/lib/billing/booking-checkout", () => ({
  initiateBookingCheckout: (...args: unknown[]) => initiateBookingCheckout(...args),
}));

const single = jest.fn();
function supabaseStub() {
  return {
    from: (table: string) => {
      if (table !== "pharmacy_orders") throw new Error(`unexpected table ${table}`);
      return { select: () => ({ eq: () => ({ single }) }) };
    },
  };
}

import { payForPharmacyOrder } from "./actions";

function formDataFor(orderId: string) {
  const fd = new FormData();
  fd.set("orderId", orderId);
  return fd;
}

describe("payForPharmacyOrder", () => {
  beforeEach(() => {
    single.mockReset();
    initiateBookingCheckout.mockReset();
    redirect.mockReset();
    requireOwnedBookingOrder.mockReset().mockResolvedValue({
      supabase: supabaseStub(),
      user: { id: "patient-1", email: "patient@tarragon.test" },
      order: {
        id: "order-1",
        organisation_id: "org-1",
        patient_id: "patient-1",
        status: "pending_payment",
      },
    });
    initiateBookingCheckout.mockResolvedValue({ ok: true, checkoutUrl: "https://paystack.test/x" });
  });

  it("charges the discounted payable_kobo when a voucher was applied to the order", async () => {
    single.mockResolvedValue({ data: { payable_kobo: 300000, total_kobo: 500000 } });

    await payForPharmacyOrder(undefined, formDataFor("order-1"));

    expect(initiateBookingCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ amountKobo: 300000 }),
    );
    expect(redirect).toHaveBeenCalledWith("https://paystack.test/x");
  });

  it("charges the full total_kobo when no discount applies (payable_kobo equals it)", async () => {
    single.mockResolvedValue({ data: { payable_kobo: 500000, total_kobo: 500000 } });

    await payForPharmacyOrder(undefined, formDataFor("order-1"));

    expect(initiateBookingCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ amountKobo: 500000 }),
    );
  });

  it("falls back to total_kobo if payable_kobo is null", async () => {
    single.mockResolvedValue({ data: { payable_kobo: null, total_kobo: 500000 } });

    await payForPharmacyOrder(undefined, formDataFor("order-1"));

    expect(initiateBookingCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ amountKobo: 500000 }),
    );
  });
});
