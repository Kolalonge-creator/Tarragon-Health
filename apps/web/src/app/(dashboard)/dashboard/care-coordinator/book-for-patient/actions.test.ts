/**
 * Care Coordinator phone booking, server actions. The booking rules themselves (who may book, Free patients refused, the 24 hour hold,
 * confirm on payment) are proven in the database by packages/db/tests/coordinator_phone_booking.sql. This covers what lives here: the
 * search passes only the typed text to the database function and reshapes its answer, and a pay link is made only for the booking
 * this coordinator made, while it is waiting for payment, and never for the signed-in coordinator's own account.
 */

const rpc = jest.fn();
const maybeSingle = jest.fn();
const getUser = jest.fn();
const purchaseServiceProduct = jest.fn();
const outstandingLimit = jest.fn();
const outstandingCalls: Array<[string, ...unknown[]]> = [];
const verifyTransactionDetail = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockImplementation(async () => ({
    rpc,
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  })),
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "not", "order"]) chain[m] = (...a: unknown[]) => (outstandingCalls.push([m, ...a]), chain);
      chain.limit = outstandingLimit;
      return chain;
    },
  }),
}));
jest.mock("@/lib/paystack/transactions", () => ({ verifyTransactionDetail: (r: string) => verifyTransactionDetail(r) }));
jest.mock("@/lib/billing/purchase-service-product", () => ({ purchaseServiceProduct: (a: unknown) => purchaseServiceProduct(a) }));

import { createPayLink, findPatients, getPayLink, retryConfirm } from "./actions";

const APPT = "11111111-1111-4111-8111-111111111111";
const waiting = {
  id: APPT,
  patient_id: "patient-1",
  status: "booked",
  payment_status: "pending",
  appointment_type: "telemedicine",
  booked_via: "coordinator_phone",
  booked_by: "coord-1",
};

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "coord-1" } } });
  maybeSingle.mockResolvedValue({ data: waiting, error: null });
  purchaseServiceProduct.mockResolvedValue({ checkoutUrl: "https://checkout.paystack.com/abc" });
  outstandingCalls.length = 0;
  outstandingLimit.mockResolvedValue({ data: [], error: null });
});

const FRESH = () => ({ id: "purchase-1", updated_at: new Date().toISOString(), pending_payment_provider_ref: "ref-1" });

describe("findPatients", () => {
  it("refuses a query under 3 characters without calling the database", async () => {
    const r = await findPatients({ query: "ab" });
    expect(r).toEqual({ error: expect.stringContaining("at least 3") });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns only name, state, phone and tier, mapped from the database function", async () => {
    rpc.mockResolvedValue({
      data: [{ patient_id: "p1", full_name: "Ada Obi", state: "Lagos", phone: "+2348012345678", membership_tier: null }],
      error: null,
    });
    const r = await findPatients({ query: "Ada" });
    expect(rpc).toHaveBeenCalledWith("coordinator_find_patient", { p_query: "Ada" });
    expect(r).toEqual({
      patients: [{ patientId: "p1", fullName: "Ada Obi", state: "Lagos", phone: "+2348012345678", membershipTier: null }],
    });
  });

  it("passes a database refusal through (for example a non-coordinator)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "only a care coordinator can look up a patient to book for them" } });
    expect(await findPatients({ query: "Ada" })).toEqual({ error: expect.stringContaining("care coordinator") });
  });
});

describe("createPayLink", () => {
  it("buys the product for the PATIENT, with the payer's email, never for the coordinator", async () => {
    const r = await createPayLink({ appointmentId: APPT, payerEmail: "son@example.com" });
    expect(r).toEqual({ checkoutUrl: "https://checkout.paystack.com/abc" });
    expect(purchaseServiceProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceProductCode: "video_visit_credit",
        patientId: "patient-1",
        callbackPath: "/payment-received",
        caller: { id: "coord-1", email: "son@example.com" },
      }),
    );
  });

  it("shows the SAME link again instead of making a second one (a second would orphan a payment on the first)", async () => {
    outstandingLimit.mockResolvedValue({ data: [{ ...FRESH(), pending_payment_checkout_url: "https://checkout.paystack.com/first" }], error: null });
    expect(await createPayLink({ appointmentId: APPT, payerEmail: "son@example.com" })).toEqual({
      checkoutUrl: "https://checkout.paystack.com/first",
      reused: true,
    });
    expect(purchaseServiceProduct).not.toHaveBeenCalled();
  });

  it("refuses, and does not replace, a recent link that was made before links were kept", async () => {
    outstandingLimit.mockResolvedValue({ data: [{ ...FRESH(), pending_payment_checkout_url: null }], error: null });
    expect(await createPayLink({ appointmentId: APPT, payerEmail: "son@example.com" })).toEqual({ error: expect.stringContaining("cannot be shown again") });
    expect(purchaseServiceProduct).not.toHaveBeenCalled();
  });

  it("looks only at the patient's pending purchase for THIS product (a wrong filter would reuse an unrelated link)", async () => {
    await createPayLink({ appointmentId: APPT, payerEmail: "son@example.com" });
    expect(outstandingCalls).toEqual(
      expect.arrayContaining([
        ["eq", "patient_id", "patient-1"],
        ["eq", "status", "pending_payment"],
        ["eq", "service_product.code", "video_visit_credit"],
      ]),
    );
  });

  const staleRow = {
    id: "purchase-1",
    updated_at: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(),
    pending_payment_provider_ref: "ref-old",
    pending_payment_checkout_url: "https://checkout.paystack.com/old",
  };
  const verdict = (status: string) => ({ ok: true, data: { status, amountMinor: null, currency: null, feeMinor: null } });

  it("replaces a link older than 24 hours only when Paystack says it was abandoned", async () => {
    outstandingLimit.mockResolvedValue({ data: [staleRow], error: null });
    verifyTransactionDetail.mockResolvedValue(verdict("abandoned"));
    expect(await createPayLink({ appointmentId: APPT, payerEmail: "son@example.com" })).toEqual({ checkoutUrl: "https://checkout.paystack.com/abc" });
    expect(verifyTransactionDetail).toHaveBeenCalledWith("ref-old");
  });

  it("does NOT replace an old link that Paystack says is paid or under way", async () => {
    outstandingLimit.mockResolvedValue({ data: [staleRow], error: null });
    for (const status of ["success", "ongoing", "pending"]) {
      verifyTransactionDetail.mockResolvedValue(verdict(status));
      expect(await createPayLink({ appointmentId: APPT, payerEmail: "son@example.com" })).toEqual({
        checkoutUrl: "https://checkout.paystack.com/old",
        reused: true,
      });
    }
    expect(purchaseServiceProduct).not.toHaveBeenCalled();
  });

  it("does NOT replace an old link when Paystack cannot be asked", async () => {
    outstandingLimit.mockResolvedValue({ data: [staleRow], error: null });
    verifyTransactionDetail.mockResolvedValue({ ok: false, error: "down" });
    expect(await createPayLink({ appointmentId: APPT, payerEmail: "son@example.com" })).toEqual({ error: expect.stringContaining("Could not check") });
    expect(purchaseServiceProduct).not.toHaveBeenCalled();
  });

  it("refuses a booking another coordinator made", async () => {
    maybeSingle.mockResolvedValue({ data: { ...waiting, booked_by: "coord-2" }, error: null });
    expect(await createPayLink({ appointmentId: APPT, payerEmail: "son@example.com" })).toEqual({ error: expect.stringContaining("you made yourself") });
    expect(purchaseServiceProduct).not.toHaveBeenCalled();
  });

  it("refuses a booking that did not come from a phone call", async () => {
    maybeSingle.mockResolvedValue({ data: { ...waiting, booked_via: "self" }, error: null });
    expect(await createPayLink({ appointmentId: APPT, payerEmail: "son@example.com" })).toEqual({ error: expect.any(String) });
    expect(purchaseServiceProduct).not.toHaveBeenCalled();
  });

  it("refuses a booking that is already confirmed", async () => {
    maybeSingle.mockResolvedValue({ data: { ...waiting, status: "confirmed", payment_status: "paid" }, error: null });
    expect(await createPayLink({ appointmentId: APPT, payerEmail: "son@example.com" })).toEqual({ error: expect.stringContaining("not waiting") });
    expect(purchaseServiceProduct).not.toHaveBeenCalled();
  });

  it("refuses a bad email and a bad appointment id before touching anything", async () => {
    expect(await createPayLink({ appointmentId: APPT, payerEmail: "not-an-email" })).toEqual({ error: expect.any(String) });
    expect(await createPayLink({ appointmentId: "nope", payerEmail: "son@example.com" })).toEqual({ error: expect.any(String) });
    expect(purchaseServiceProduct).not.toHaveBeenCalled();
  });

  it("reports activated when nothing is left to pay (a voucher covered it)", async () => {
    purchaseServiceProduct.mockResolvedValue({ activated: true });
    expect(await createPayLink({ appointmentId: APPT, payerEmail: "son@example.com" })).toEqual({ activated: true });
  });
});

describe("retryConfirm", () => {
  it("refuses a malformed id without calling the database", async () => {
    expect(await retryConfirm("nope")).toEqual({ error: expect.any(String) });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns the new status, and passes a database refusal through", async () => {
    rpc.mockResolvedValueOnce({ data: { status: "confirmed" }, error: null });
    expect(await retryConfirm(APPT)).toEqual({ ok: true, status: "confirmed" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "that time is no longer open for consultations: pick another slot" } });
    expect(await retryConfirm(APPT)).toEqual({ error: expect.stringContaining("no longer open") });
  });
});

describe("getPayLink", () => {
  it("returns the stored link for the coordinator's own waiting booking", async () => {
    outstandingLimit.mockResolvedValue({ data: [{ ...FRESH(), pending_payment_checkout_url: "https://checkout.paystack.com/first" }], error: null });
    expect(await getPayLink(APPT)).toEqual({ checkoutUrl: "https://checkout.paystack.com/first" });
  });

  it("never makes a link: with none made it says so", async () => {
    expect(await getPayLink(APPT)).toEqual({ error: expect.stringContaining("No payment link") });
    expect(purchaseServiceProduct).not.toHaveBeenCalled();
  });

  it("refuses another coordinator's booking and a malformed id", async () => {
    maybeSingle.mockResolvedValue({ data: { ...waiting, booked_by: "coord-2" }, error: null });
    expect(await getPayLink(APPT)).toEqual({ error: expect.stringContaining("you made yourself") });
    expect(await getPayLink("nope")).toEqual({ error: expect.any(String) });
  });
});
