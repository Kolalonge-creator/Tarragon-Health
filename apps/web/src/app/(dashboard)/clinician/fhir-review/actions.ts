"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isClinicalTier } from "@tarragon/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { fieldKindOf } from "@/lib/integrations/fhir/editable-field-config";

export type FhirReviewDecisionState = { error?: string; message?: string } | undefined;

/**
 * Shared app-layer clinical-tier gate for every decision this worklist can
 * make (confirm/modify/dismiss). private.enforce_fhir_import_resource_attribution
 * remains the real, structural authority boundary — it blocks a
 * care_coordinator from ALL THREE outcomes server-side, not just confirm —
 * but CLAUDE.md's Care Coordinator rule is explicit that write access
 * adjacent to medications must also be "enforced at the app/server-action
 * layer... not a new RLS helper", the same way every other medication-
 * adjacent action in this codebase does it. This is that app-layer gate,
 * not a replacement for the DB one: a defense-in-depth pair, same shape as
 * hasPrescribingAuthority's own "this copy only gates the UI... the DB RLS
 * policy is the real enforcement boundary" framing
 * (apps/web/src/lib/clinical/doctor-tier.ts).
 *
 * Returns the proposed resource's organisation_id on success, or an error
 * string to return directly from the calling action.
 */
async function requireClinicalTierForReview(
  supabase: SupabaseClient<Database>,
  resourceId: string
): Promise<{ organisationId: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const { data: proposed } = await supabase
    .from("fhir_import_proposed_resources")
    .select("organisation_id")
    .eq("id", resourceId)
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
    return { error: "A Care Coordinator can see an imported resource but cannot act on it — only confirm, modify, or dismiss." };
  }

  return { organisationId: proposed.organisation_id };
}

/**
 * Confirms a proposed FHIR import resource as-is into the real clinical
 * record (for MedicationStatement/MedicationRequest, this writes into
 * public.medications). Confirming does not accept edits: confirmed_payload
 * is set equal to normalized_payload by the trigger itself. A clinician who
 * needs to correct a value before accepting it should use "Edit & confirm"
 * instead (modifyFhirProposedResource below).
 */
export async function confirmFhirProposedResource(
  _prev: FhirReviewDecisionState,
  formData: FormData
): Promise<FhirReviewDecisionState> {
  const id = z.string().uuid().safeParse(String(formData.get("id") ?? ""));
  if (!id.success) return { error: "Invalid request" };

  const supabase = await createClient();
  const gate = await requireClinicalTierForReview(supabase, id.data);
  if ("error" in gate) return { error: gate.error };

  const { error } = await supabase
    .from("fhir_import_proposed_resources")
    .update({ status: "confirmed" })
    .eq("id", id.data);
  if (error) return { error: error.message };

  revalidatePath("/clinician/fhir-review");
  return { message: "Confirmed — added to the patient's record." };
}

/**
 * Confirms a proposed resource with a clinician-edited payload instead of
 * the parser's raw output — the "modified" status column this table has
 * supported since the original migration (20260807084925), left without a
 * UI until now. `edited.<key>` form fields carry the new values; each is
 * coerced per `fieldKindOf(key)` (editable-field-config.ts — the same
 * config the UI uses to decide which input control to render), never a
 * client-supplied type hint, before being sent as confirmed_payload,
 * matching private.enforce_fhir_import_resource_attribution's expectation
 * that confirmed_payload is shaped exactly like normalized_payload.
 * Unknown/extra keys in the submitted form are ignored — only keys that
 * already exist in normalized_payload can be edited, so a modified proposal
 * can never smuggle in a field the parser never produced. A "readonly" key
 * (per the shared config) always keeps its original value even if the form
 * somehow submitted one — the UI never renders an input for it, but the
 * server doesn't trust that alone.
 */
export async function modifyFhirProposedResource(
  _prev: FhirReviewDecisionState,
  formData: FormData
): Promise<FhirReviewDecisionState> {
  const id = z.string().uuid().safeParse(String(formData.get("id") ?? ""));
  if (!id.success) return { error: "Invalid request" };

  const supabase = await createClient();
  const gate = await requireClinicalTierForReview(supabase, id.data);
  if ("error" in gate) return { error: gate.error };

  const { data: proposed } = await supabase
    .from("fhir_import_proposed_resources")
    .select("normalized_payload")
    .eq("id", id.data)
    .maybeSingle();
  const original = proposed?.normalized_payload as Record<string, unknown> | null;
  if (!original) return { error: "This resource is no longer waiting for review" };

  const confirmedPayload: Record<string, unknown> = {};
  for (const [key, originalValue] of Object.entries(original)) {
    const kind = fieldKindOf(key);

    if (kind === "readonly") {
      confirmedPayload[key] = originalValue;
      continue;
    }

    if (kind === "boolean") {
      // A real checkbox is always rendered for a boolean field (never
      // absent from the form the way a skipped text field could be), so
      // its presence in the submission IS the current checked state —
      // no case-sensitive "does the text say true" comparison, and no
      // ambiguity between "unchecked" and "field wasn't shown".
      confirmedPayload[key] = formData.has(`edited.${key}`);
      continue;
    }

    const raw = formData.get(`edited.${key}`);
    if (raw === null) {
      confirmedPayload[key] = originalValue;
      continue;
    }
    const text = String(raw).trim();

    if (kind === "number") {
      const parsed = Number(text);
      confirmedPayload[key] = text === "" || !Number.isFinite(parsed) ? originalValue : parsed;
    } else if (typeof kind === "object" && "select" in kind) {
      // Enum field: only a value from the real Postgres enum is ever
      // accepted — anything else (a tampered request, a stale client)
      // falls back to the original value rather than reaching the DB's
      // own ::allergy_severity/::glucose_context cast and erroring out.
      confirmedPayload[key] = (kind.select as readonly string[]).includes(text) ? text : originalValue;
    } else {
      // text / date / datetime
      confirmedPayload[key] = text === "" ? null : text;
    }
  }

  const { error } = await supabase
    .from("fhir_import_proposed_resources")
    .update({
      status: "modified",
      confirmed_payload: confirmedPayload as Database["public"]["Tables"]["fhir_import_proposed_resources"]["Update"]["confirmed_payload"],
    })
    .eq("id", id.data);
  if (error) return { error: error.message };

  revalidatePath("/clinician/fhir-review");
  return { message: "Confirmed with your edits — added to the patient's record." };
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
  const gate = await requireClinicalTierForReview(supabase, id.data);
  if ("error" in gate) return { error: gate.error };

  const { error } = await supabase
    .from("fhir_import_proposed_resources")
    .update({ status: "dismissed", dismissal_reason: reason })
    .eq("id", id.data);
  if (error) return { error: error.message };

  revalidatePath("/clinician/fhir-review");
  return { message: "Dismissed." };
}
