"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { purchaseServiceProduct } from "@/lib/billing/purchase-service-product";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { verifyTransactionDetail } from "@/lib/paystack/transactions";
import { PAID_APPOINTMENT_PRODUCT_CODE } from "@/app/(dashboard)/patient/appointments/appointment-labels";
import { describeFollowupError, formatLagos, myFollowupsSchema, pickResultSchema, type MyFollowups } from "@/lib/followups/followups";

export type FoundPatient = {
  patientId: string;
  fullName: string;
  state: string | null;
  phone: string | null;
  membershipTier: string | null;
};

const lookupSchema = z.object({ query: z.string().trim().min(3, "Type at least 3 characters of a name or phone number").max(80) });

/**
 * Name, state, phone and tier only. The database function is the gate (care coordinators only, own organisation, each hit audited),
 * so nothing here widens what a coordinator can see.
 */
export async function findPatients(
  input: z.input<typeof lookupSchema>,
): Promise<{ patients: FoundPatient[] } | { error: string }> {
  const parsed = lookupSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the search and try again" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("coordinator_find_patient", { p_query: parsed.data.query });
  if (error) return { error: error.message };
  return {
    patients: (data ?? []).map((r) => ({
      patientId: r.patient_id,
      fullName: r.full_name ?? "Unnamed patient",
      state: r.state,
      phone: r.phone,
      membershipTier: r.membership_tier,
    })),
  };
}

const appointmentIdSchema = z.string().uuid();

const payLinkSchema = z.object({
  appointmentId: appointmentIdSchema,
  payerEmail: z.string().trim().email("Enter the email address of the person who will pay"),
});

export type PayLinkResult = { checkoutUrl: string; reused?: boolean } | { activated: true } | { error: string };

type WaitingBooking = { userId: string; patientId: string; productCode: string };

/** The booking must be this coordinator's own phone booking, and still waiting for payment. */
async function loadWaitingBooking(appointmentId: string): Promise<WaitingBooking | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out. Sign in again to continue." };

  const { data: appt, error } = await supabase
    .from("appointments")
    .select("id, patient_id, status, payment_status, appointment_type, booked_via, booked_by")
    .eq("id", appointmentId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!appt) return { error: "That appointment could not be found" };
  if (appt.booked_via !== "coordinator_phone" || appt.booked_by !== user.id) {
    return { error: "You can only make a pay link for a booking you made yourself" };
  }
  if (appt.status !== "booked" || appt.payment_status !== "pending") {
    return { error: "This booking is not waiting for payment" };
  }
  const productCode = PAID_APPOINTMENT_PRODUCT_CODE[appt.appointment_type];
  if (!productCode) return { error: "This kind of appointment has nothing to pay for" };
  return { userId: user.id, patientId: appt.patient_id, productCode };
}

type OutstandingLink = { found: false } | { found: true; checkoutUrl: string | null };

const LINK_HOLD_MS = 24 * 60 * 60 * 1000;

/**
 * The payment link already made for this patient and item, if one could still be paid. The patient's pending purchase for a product is
 * shared and holds ONE payment reference: Paystack cannot cancel a started transaction, so a second link would replace the first and a
 * payer who then used the first would be charged with nothing to match it to. So:
 *  - a link made in the last 24 hours (the length of the hold) is shown again, never replaced;
 *  - an older one is replaced only after Paystack says it was abandoned or failed. If Paystack says it is paid or under way, or cannot
 *    be asked, nothing is replaced (a payment not yet applied must not lose its reference).
 */
async function findOutstandingLink(patientId: string, productCode: string): Promise<OutstandingLink | { error: string }> {
  const { data, error } = await createServiceRoleClient()
    .from("service_purchases")
    .select("id, updated_at, pending_payment_provider_ref, pending_payment_checkout_url, service_product:service_products!inner(code)")
    .eq("patient_id", patientId)
    .eq("status", "pending_payment")
    .not("pending_payment_provider_ref", "is", null)
    .eq("service_product.code", productCode)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) return { error: error.message };
  const row = data?.[0];
  if (!row) return { found: false };
  if (Date.now() - new Date(row.updated_at).getTime() < LINK_HOLD_MS) return { found: true, checkoutUrl: row.pending_payment_checkout_url };

  const check = await verifyTransactionDetail(row.pending_payment_provider_ref as string);
  if (!check.ok) return { error: "Could not check the earlier payment link with Paystack, so no new one was made. Try again in a moment." };
  if (check.data.status === "abandoned" || check.data.status === "failed") return { found: false };
  return { found: true, checkoutUrl: row.pending_payment_checkout_url };
}

/**
 * Makes the Paystack link for a phone booking that is waiting on payment, or shows the one already made. The coordinator never takes
 * card details: they send the link to the patient or a relative (card or bank transfer is chosen on the Paystack page). Only the
 * coordinator who made the booking can use it, and only while it is still waiting. When the payment lands the database confirms the
 * booking by itself.
 */
export async function createPayLink(input: z.input<typeof payLinkSchema>): Promise<PayLinkResult> {
  const parsed = payLinkSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details and try again" };

  const booking = await loadWaitingBooking(parsed.data.appointmentId);
  if ("error" in booking) return booking;

  const outstanding = await findOutstandingLink(booking.patientId, booking.productCode);
  if ("error" in outstanding) return outstanding;
  if (outstanding.found) {
    if (outstanding.checkoutUrl) return { checkoutUrl: outstanding.checkoutUrl, reused: true };
    // made before links were kept: it cannot be shown again, and replacing it could orphan a payment
    return { error: "A payment link was made for this patient earlier and cannot be shown again. Ask the payer to use it; a new one can be made once Paystack shows it was not used." };
  }

  const result = await purchaseServiceProduct({
    serviceProductCode: booking.productCode,
    patientId: booking.patientId,
    callbackPath: "/payment-received",
    caller: { id: booking.userId, email: parsed.data.payerEmail },
  });
  if (!result) return { error: "Could not start the payment" };
  if (result.error) return { error: friendlyPayError(result.error) };
  if (result.checkoutUrl) return { checkoutUrl: result.checkoutUrl };
  if (result.activated) return { activated: true };
  return { error: "Could not start the payment" };
}

/**
 * The purchase function's own refusals are written for developers ("service product video_visit_credit is not available"). A coordinator
 * on a call needs to know what to do: a visit that is not on sale cannot be paid for by link, and the care lead decides how it is covered.
 */
function friendlyPayError(message: string): string {
  if (/is not available/i.test(message)) {
    return "This visit cannot be paid for by link right now because it is not on sale. Tell the patient you will call back, and ask the care lead how it should be covered.";
  }
  return message;
}

/** Shows again the link already made for a waiting phone booking (a lost link). Never makes a new one. */
export async function getPayLink(appointmentId: string): Promise<{ checkoutUrl: string } | { none: true } | { error: string }> {
  if (!appointmentIdSchema.safeParse(appointmentId).success) return { error: "That appointment could not be found" };
  const booking = await loadWaitingBooking(appointmentId);
  if ("error" in booking) return booking;
  const outstanding = await findOutstandingLink(booking.patientId, booking.productCode);
  if ("error" in outstanding) return outstanding;
  if (!outstanding.found) return { none: true };
  if (!outstanding.checkoutUrl) return { error: "That link was made before links were kept, so it cannot be shown again. Ask the payer to use it." };
  return { checkoutUrl: outstanding.checkoutUrl };
}

/**
 * Try to confirm a phone booking again, for the case where the payment arrived but the automatic confirmation did not (it is listed
 * with its reason). Same rules as any confirm: the database refuses it if the slot is gone or the booking was not paid for.
 */
export async function retryConfirm(appointmentId: string): Promise<{ ok: true; status: string } | { error: string }> {
  if (!appointmentIdSchema.safeParse(appointmentId).success) return { error: "That appointment could not be found" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_appointment_booking", { p_appointment_id: appointmentId });
  if (error) return { error: error.message };
  return { ok: true, status: data.status };
}

/**
 * A Member's included monthly meeting: the doctor offers times and the patient picks one. This reads what has been offered to the patient
 * the coordinator is speaking to. The database function admits a care coordinator of the patient's own organisation and nobody else, so an
 * unrelated id answers with nothing rather than someone's offers.
 */
export async function getMonthlyMeeting(patientId: string): Promise<{ meeting: MyFollowups } | { error: string }> {
  if (!appointmentIdSchema.safeParse(patientId).success) return { error: "That patient could not be found" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_followups" as never, { p_patient: patientId } as never);
  if (error) return { error: "Could not load this patient's monthly meeting. Try again." };
  const parsed = myFollowupsSchema.safeParse(data);
  if (!parsed.success) return { error: "Could not read this patient's monthly meeting. Try again." };
  return { meeting: parsed.data };
}

/**
 * The coordinator picks one of the offered times for the patient, on the call. Same function the patient uses: it runs the live hold and
 * confirm, spends the month's included meeting (no payment), and stamps the booking as made by the coordinator by phone.
 */
export async function pickMonthlySlot(slotId: string): Promise<{ message: string } | { error: string }> {
  if (!appointmentIdSchema.safeParse(slotId).success) return { error: "That time could not be found" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pick_followup_slot" as never, { p_slot: slotId, p_ask_longer: false } as never);
  if (error) return { error: describeFollowupError(error, "Could not book that time. Try again or pick another.") };
  const parsed = pickResultSchema.safeParse(data);
  if (!parsed.success) return { error: "Could not book that time. Try again or pick another." };
  switch (parsed.data.status) {
    case "booked":
      return { message: `Booked for ${parsed.data.starts_at ? formatLagos(parsed.data.starts_at) : "the chosen time"}. It is on the patient's appointments now.` };
    case "unavailable":
      return { error: "That time was just taken. Pick another." };
    case "expired":
    case "withdrawn":
      return { error: "These times have expired. The doctor will offer new ones." };
    default:
      return { error: "Could not book that time. Try again or pick another." };
  }
}
