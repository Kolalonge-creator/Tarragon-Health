"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type FhirReviewDecisionState = { error?: string; message?: string } | undefined;

/**
 * Confirms a proposed FHIR import resource as-is into the real clinical
 * record. Runs entirely under the caller's own session, RLS-admitted then
 * narrowed by private.enforce_fhir_import_resource_attribution — a
 * non-clinical or wrong-org caller gets that trigger's own error message
 * surfaced here, not a client-side authority check duplicating the DB's own
 * gate. Confirming does not accept edits: confirmed_payload is set equal to
 * normalized_payload by the trigger itself. A clinician who needs to
 * correct a value before accepting it should dismiss with a reason instead
 * and wait for the partner to resend a corrected resource — the "modified"
 * status this table supports is a real column-level capability but this
 * worklist does not yet expose an edit form for it (fast-follow, not a
 * structural gap: the DB already enforces confirmed_payload correctly for
 * that path whenever a UI is built for it).
 */
export async function confirmFhirProposedResource(
  _prev: FhirReviewDecisionState,
  formData: FormData
): Promise<FhirReviewDecisionState> {
  const id = z.string().uuid().safeParse(String(formData.get("id") ?? ""));
  if (!id.success) return { error: "Invalid request" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("fhir_import_proposed_resources")
    .update({ status: "confirmed" })
    .eq("id", id.data);
  if (error) return { error: error.message };

  revalidatePath("/clinician/fhir-review");
  return { message: "Confirmed — added to the patient's record." };
}

export async function dismissFhirProposedResource(
  _prev: FhirReviewDecisionState,
  formData: FormData
): Promise<FhirReviewDecisionState> {
  const id = z.string().uuid().safeParse(String(formData.get("id") ?? ""));
  if (!id.success) return { error: "Invalid request" };
  const reason = String(formData.get("dismissal_reason") ?? "").trim();
  if (!reason) return { error: "A dismissal needs a reason." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("fhir_import_proposed_resources")
    .update({ status: "dismissed", dismissal_reason: reason })
    .eq("id", id.data);
  if (error) return { error: error.message };

  revalidatePath("/clinician/fhir-review");
  return { message: "Dismissed." };
}
