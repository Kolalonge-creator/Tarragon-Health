"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isClinicalTier } from "@/lib/clinical/doctor-tier";
import {
  advanceImagingOrderStatusSchema,
  cancelImagingOrderSchema,
  createImagingOrderSchema,
} from "@/lib/validation/imaging-orders";

export type ImagingOrderActionResult = { error?: string; success?: boolean; orderId?: string };

/**
 * A clinician orders an imaging investigation for a patient (spec §59.4).
 * Runs through the clinician's own RLS-scoped session — private.is_org_staff
 * + private.has_imaging_ordering_authority (Tier 1-5 or Clinical Director,
 * never a Care Coordinator) are the real DB-level gate; this action's own
 * clinical_staff lookup exists only to give a friendly error message before
 * attempting the insert, same posture as markEcgReportReviewed.
 */
export async function createImagingOrder(
  input: unknown
): Promise<ImagingOrderActionResult> {
  const parsed = createImagingOrderSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const {
    patient_id: patientId,
    study_id: studyId,
    urgency,
    indication,
    clinical_information: clinicalInformation,
    contraindication_information: contraindicationInformation,
  } = parsed.data;

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();

  const { data: patient } = await supabase
    .from("profiles")
    .select("id, organisation_id")
    .eq("id", patientId)
    .eq("role", "patient")
    .maybeSingle();
  if (!patient || !patient.organisation_id) {
    return { error: "That patient isn't in your organisation." };
  }

  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("id, doctor_tier, is_clinical_director")
    .eq("profile_id", user.id)
    .eq("organisation_id", patient.organisation_id)
    .eq("active", true)
    .maybeSingle();

  // isClinicalTier (lib/clinical/doctor-tier.ts) is the same "any Tier 1-5 or
  // Clinical Director, never Care Coordinator" predicate used across the
  // rest of the clinician UI — this is a friendly pre-check only, since
  // private.has_imaging_ordering_authority is the real DB-level gate.
  if (!staff || !isClinicalTier(staff)) {
    return { error: "Only a doctor (Tier 1 or above) or Clinical Director can order imaging." };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("imaging_orders")
    .insert({
      organisation_id: patient.organisation_id,
      patient_id: patientId,
      ordering_clinician_id: staff.id,
      study_id: studyId,
      urgency,
      indication,
      clinical_information: clinicalInformation ?? null,
      contraindication_information: contraindicationInformation ?? null,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    return { error: insertError?.message ?? "Could not create that order." };
  }

  revalidatePath(`/clinician/patients/${patientId}`);
  return { success: true, orderId: inserted.id };
}

/** Staff cancels an order — a reason is always required (DB-enforced too). */
export async function cancelImagingOrder(input: unknown): Promise<ImagingOrderActionResult> {
  const parsed = cancelImagingOrderSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { order_id: orderId, reason } = parsed.data;

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const supabase = await createClient();

  const { data: order, error } = await supabase
    .from("imaging_orders")
    .update({ status: "cancelled", cancellation_reason: reason })
    .eq("id", orderId)
    .select("patient_id")
    .single();
  if (error || !order) return { error: error?.message ?? "Could not cancel that order." };

  revalidatePath(`/clinician/patients/${order.patient_id}`);
  return { success: true };
}

/**
 * Staff advances an order through the workflow (§59.7). The DB's own
 * imaging_orders_stamp_lifecycle trigger stamps the matching timestamp
 * (booked_at/attended_at/performed_at/result_returned_at/reviewed_at) and
 * refuses a transition out of a cancelled/reviewed order.
 */
export async function advanceImagingOrderStatus(
  input: unknown
): Promise<ImagingOrderActionResult> {
  const parsed = advanceImagingOrderStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { order_id: orderId, status } = parsed.data;

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const supabase = await createClient();

  const { data: order, error } = await supabase
    .from("imaging_orders")
    .update({ status })
    .eq("id", orderId)
    .select("patient_id")
    .single();
  if (error || !order) return { error: error?.message ?? "Could not update that order." };

  revalidatePath(`/clinician/patients/${order.patient_id}`);
  return { success: true };
}
