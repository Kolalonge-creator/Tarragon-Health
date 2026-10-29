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

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockImplementation(async () => ({
    rpc,
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  })),
}));
jest.mock("@/lib/billing/purchase-service-product", () => ({ purchaseServiceProduct: (a: unknown) => purchaseServiceProduct(a) }));

import { createPayLink, findPatients } from "./actions";

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
});

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
