/**
 * initiateSponsoredServiceReservationCheckout() is the checkout-init half of
 * the diaspora reservation flow: it must never start a Paystack checkout
 * without first getting a real pending_payment reservation row back from
 * create_sponsored_service_reservation, and it must refuse a non-NGN product
 * before charging anything (reservations only support naira-priced
 * services, per the RPC's own guard).
 *
 * The price it charges must come from the reservation row the RPC just
 * created (sponsored_service_reservations.amount_kobo), not a fresh
 * service_products read — a second, later price read would race a live
 * price edit and could charge an amount the activation trigger's own
 * amount_minor <> amount_kobo check would then reject, stranding the
 * reservation at pending_payment forever (found in code review before this
 * ever merged).
 */

const getUser = jest.fn();
const rpc = jest.fn();
const maybeSingle = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: { getUser },
    rpc,
    from: (table: string) => {
      if (table !== "sponsored_service_reservations") throw new Error(`unexpected table ${table}`);
      return { select: () => ({ eq: () => ({ maybeSingle }) }) };
    },
  }),
}));

const isPaystackConfigured = jest.fn();
jest.mock("@/lib/paystack/client", () => ({ isPaystackConfigured: () => isPaystackConfigured() }));

const initializeOneOffTransaction = jest.fn();
jest.mock("@/lib/paystack/transactions", () => ({
  initializeOneOffTransaction: (...args: unknown[]) => initializeOneOffTransaction(...args),
}));

import { initiateSponsoredServiceReservationCheckout } from "./sponsored-service-reservation-checkout";

const ARGS = {
  serviceProductId: "svc-1",
  recipientPhone: "+2348012345678",
  recipientFirstName: "Amaka",
  email: "sponsor@example.com",
  callbackUrl: "https://app.tarragonhealth.ng/patient/supporting",
};

describe("initiateSponsoredServiceReservationCheckout", () => {
  beforeEach(() => {
    getUser.mockReset();
    rpc.mockReset();
    maybeSingle.mockReset();
    isPaystackConfigured.mockReset();
    initializeOneOffTransaction.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: "sponsor-1" } } });
    isPaystackConfigured.mockReturnValue(true);
  });

  it("refuses when nobody is signed in", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const result = await initiateSponsoredServiceReservationCheckout(ARGS);

    expect(result).toEqual({ ok: false, error: "Not signed in" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses when Paystack isn't configured", async () => {
    isPaystackConfigured.mockReturnValue(false);

    const result = await initiateSponsoredServiceReservationCheckout(ARGS);

    expect(result).toEqual({ ok: false, error: "Card payments aren't set up yet" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces the RPC's own error and never starts checkout", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "that service is not available" } });

    const result = await initiateSponsoredServiceReservationCheckout(ARGS);

    expect(result).toEqual({ ok: false, error: "that service is not available" });
    expect(initializeOneOffTransaction).not.toHaveBeenCalled();
  });

  it("refuses a non-NGN reservation even after the reservation row is created", async () => {
    rpc.mockResolvedValue({ data: "resv-1", error: null });
    maybeSingle.mockResolvedValue({ data: { amount_kobo: 500000, currency: "USD" } });

    const result = await initiateSponsoredServiceReservationCheckout(ARGS);

    expect(result).toEqual({ ok: false, error: "That service can't be paid in your currency yet." });
    expect(initializeOneOffTransaction).not.toHaveBeenCalled();
  });

  it("charges the price stored ON THE RESERVATION, not a fresh service_products read (regression: closes a price-race window)", async () => {
    rpc.mockResolvedValue({ data: "resv-1", error: null });
    // A price that has since drifted from whatever service_products says now
    // — this must be what gets charged, since it's what the activation
    // trigger will check the payment against.
    maybeSingle.mockResolvedValue({ data: { amount_kobo: 500000, currency: "NGN" } });
    initializeOneOffTransaction.mockResolvedValue({
      ok: true,
      data: { authorizationUrl: "https://paystack.com/pay/abc" },
    });

    const result = await initiateSponsoredServiceReservationCheckout(ARGS);

    expect(result).toEqual({ ok: true, checkoutUrl: "https://paystack.com/pay/abc" });
    expect(rpc).toHaveBeenCalledWith("create_sponsored_service_reservation", {
      p_service_product_id: "svc-1",
      p_recipient_phone: "+2348012345678",
      p_recipient_first_name: "Amaka",
    });
    expect(initializeOneOffTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMinor: 500000,
        currency: "NGN",
        metadata: expect.objectContaining({
          kind: "sponsored_service_reservation",
          reservation_id: "resv-1",
        }),
      })
    );
  });
});
