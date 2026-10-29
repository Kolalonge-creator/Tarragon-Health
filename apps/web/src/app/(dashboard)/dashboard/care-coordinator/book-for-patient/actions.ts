"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { purchaseServiceProduct } from "@/lib/billing/purchase-service-product";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { PAID_APPOINTMENT_PRODUCT_CODE } from "@/app/(dashboard)/patient/appointments/appointment-labels";

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

const payLinkSchema = z.object({
  appointmentId: z.string().uuid(),
  payerEmail: z.string().trim().email("Enter the email address of the person who will pay"),
});

export type PayLinkResult = { checkoutUrl: string } | { activated: true } | { error: string };

/**
 * Makes the Paystack link for a phone booking that is waiting on payment. The coordinator never takes card details: they send the
 * link to the patient or a relative (card or bank transfer is chosen on the Paystack page). Only the coordinator who made the booking
 * can make its link, and only while it is still waiting. When the payment lands the database confirms the booking by itself.
 */
export async function createPayLink(input: z.input<typeof payLinkSchema>): Promise<PayLinkResult> {
  const parsed = payLinkSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details and try again" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out. Sign in again to continue." };

  const { data: appt, error } = await supabase
    .from("appointments")
    .select("id, patient_id, status, payment_status, appointment_type, booked_via, booked_by")
    .eq("id", parsed.data.appointmentId)
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

  // One payment link at a time. The patient's pending purchase for this product is shared and holds a single payment reference, so a
  // second link would replace the first: a payer who already used the first link would be charged with nothing to match it to. A link
  // older than the 24 hour hold no longer counts, so a lost link cannot block the patient for ever.
  const { data: outstanding, error: outstandingError } = await createServiceRoleClient()
    .from("service_purchases")
    .select("id, service_product:service_products!inner(code)")
    .eq("patient_id", appt.patient_id)
    .eq("status", "pending_payment")
    .not("pending_payment_provider_ref", "is", null)
    .gt("updated_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .eq("service_product.code", productCode)
    .limit(1);
  if (outstandingError) return { error: outstandingError.message };
  if (outstanding && outstanding.length > 0) {
    return { error: "A payment link made in the last 24 hours is still out for this patient. Ask the payer to use it; a new one can be made once it has lapsed." };
  }

  const result = await purchaseServiceProduct({
    serviceProductCode: productCode,
    patientId: appt.patient_id,
    callbackPath: "/payment-received",
    caller: { id: user.id, email: parsed.data.payerEmail },
  });
  if (!result) return { error: "Could not start the payment" };
  if (result.error) return { error: result.error };
  if (result.checkoutUrl) return { checkoutUrl: result.checkoutUrl };
  if (result.activated) return { activated: true };
  return { error: "Could not start the payment" };
}

/**
 * Try to confirm a phone booking again, for the case where the payment arrived but the automatic confirmation did not (it is listed
 * with its reason). Same rules as any confirm: the database refuses it if the slot is gone or the booking was not paid for.
 */
export async function retryConfirm(appointmentId: string): Promise<{ ok: true; status: string } | { error: string }> {
  if (!z.string().uuid().safeParse(appointmentId).success) return { error: "That appointment could not be found" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_appointment_booking", { p_appointment_id: appointmentId });
  if (error) return { error: error.message };
  return { ok: true, status: data.status };
}
