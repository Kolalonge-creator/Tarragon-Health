"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isClinicalTier } from "@tarragon/shared";

export type FhirReviewDecisionState = { error?: string; message?: string } | undefined;

/**
 * Confirms a proposed FHIR import resource as-is into the real clinical
 * record (for MedicationStatement/MedicationRequest, this writes into
 * public.medications). private.enforce_fhir_import_resource_attribution
 * remains the real, structural authority boundary — it already blocks a
 * care_coordinator server-side — but CLAUDE.md's Care Coordinator rule is
 * explicit that write access to medications must also be "enforced at the
 * app/server-action layer... not a new RLS helper", the same way every
 * other medication-adjacent action in this codebase does it. The check
 * below is that app-layer gate, not a replacement for the DB one: a
 * defense-in-depth pair, same shape as hasPrescribingAuthority's own
 * "this copy only gates the UI... the DB RLS policy is the real enforcement
 * boundary" framing (apps/web/src/lib/clinical/doctor-tier.ts).
 *
 * Confirming does not accept edits: confirmed_payload is set equal to
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

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();

  const { data: proposed } = await supabase
    .from("fhir_import_proposed_resources")
    .select("organisation_id")
    .eq("id", id.data)
    .maybeSingle();
  if (!proposed) return { error: "This resource is no longer waiting for review" };

  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("doctor_tier")
    .eq("profile_id", user.id)
    .eq("organisation_id", proposed.organisation_id)
    .eq("active", true)
    .maybeSingle();
  if (!isClinicalTier(staff)) {
    return { error: "A Care Coordinator can see an imported resource but cannot confirm it into the clinical record." };
  }

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
