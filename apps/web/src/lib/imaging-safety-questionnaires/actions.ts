"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { submitImagingSafetyQuestionnaireSchema } from "@/lib/validation/imaging-safety-questionnaires";

export type SubmitImagingSafetyQuestionnaireResult = { error?: string; success?: boolean };

/**
 * Submits a pre-procedure safety questionnaire for an imaging order (spec
 * §59.6). Runs through the caller's own RLS-scoped session — a patient may
 * submit their own order's questionnaire, org staff may submit on behalf of
 * any of their org's patients. private.handle_imaging_safety_questionnaire()
 * raises a clinician_review alert automatically when has_contraindication
 * is true; this action does not duplicate that.
 */
export async function submitImagingSafetyQuestionnaire(
  input: unknown
): Promise<SubmitImagingSafetyQuestionnaireResult> {
  const parsed = submitImagingSafetyQuestionnaireSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const {
    imaging_order_id: imagingOrderId,
    template_key: templateKey,
    questions,
    answers,
    has_contraindication: hasContraindication,
    contraindication_notes: contraindicationNotes,
  } = parsed.data;

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("imaging_orders")
    .select("id, organisation_id, patient_id")
    .eq("id", imagingOrderId)
    .maybeSingle();
  if (!order) return { error: "That imaging order isn't on your record." };

  const { error } = await supabase.from("imaging_safety_questionnaires").insert({
    organisation_id: order.organisation_id,
    patient_id: order.patient_id,
    imaging_order_id: imagingOrderId,
    template_key: templateKey,
    questions,
    answers,
    has_contraindication: hasContraindication,
    contraindication_notes: contraindicationNotes ?? null,
    completed_by: user.id,
    completed_at: new Date().toISOString(),
  });
  if (error) return { error: error.message };

  revalidatePath(`/clinician/patients/${order.patient_id}`);
  revalidatePath("/patient");
  return { success: true };
}
