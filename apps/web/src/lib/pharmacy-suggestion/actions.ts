"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { suggestFormSchema, withdrawFormSchema } from "./model";

export type SuggestState = { ok: boolean; message: string } | undefined;

/**
 * Records a SUGGESTION. It routes nothing: the prescription stays signed and nobody at a pharmacy can see it until the patient confirms.
 * The database checks the tie, the clinical tier and that the pharmacy is verified and listable.
 */
export async function suggestPharmacyAction(_prev: SuggestState, formData: FormData): Promise<SuggestState> {
  const parsed = suggestFormSchema.safeParse({
    patientId: formData.get("patientId"),
    prescriptionId: formData.get("prescriptionId"),
    partnerId: formData.get("partnerId"),
    locationId: formData.get("locationId"),
  });
  if (!parsed.success) return { ok: false, message: "That did not work and nothing was changed." };
  if (!(await getCurrentUser())) return { ok: false, message: "Please sign in again." };
  const { error } = await loose(await createClient()).rpc("care_team_suggest_pharmacy", {
    p_prescription: parsed.data.prescriptionId,
    p_partner: parsed.data.partnerId,
    p_location: parsed.data.locationId,
  });
  if (error) {
    if (error.message.includes("pharmacy_not_available")) return { ok: false, message: "That pharmacy is not available any more. Please pick another." };
    if (error.message.includes("patient_cannot_confirm")) return { ok: false, message: "This patient's account is managed by someone else and cannot confirm a suggestion. The signed prescription can be taken to any pharmacy." };
    if (error.message.includes("suggestion_not_open")) return { ok: false, message: "This prescription is no longer waiting for a pharmacy." };
    return { ok: false, message: "The suggestion was not saved. Nothing was sent." };
  }
  revalidatePath(`/clinician/patients/${parsed.data.patientId}`);
  return { ok: true, message: "Suggestion saved. The patient chooses; nothing is sent until the patient confirms." };
}

/** Withdraws a pending suggestion of her own. A refusal, an error and "already settled" are all said out loud, never shown as success. */
export async function withdrawSuggestionAction(_prev: SuggestState, formData: FormData): Promise<SuggestState> {
  const parsed = withdrawFormSchema.safeParse({ patientId: formData.get("patientId"), suggestionId: formData.get("suggestionId") });
  if (!parsed.success) return { ok: false, message: "That did not work and nothing was changed." };
  if (!(await getCurrentUser())) return { ok: false, message: "Please sign in again." };
  const { data, error } = await loose(await createClient()).rpc("care_team_withdraw_pharmacy_suggestion", { p_suggestion: parsed.data.suggestionId });
  if (error) return { ok: false, message: "Only the clinician who made the suggestion can withdraw it. Nothing was changed." };
  revalidatePath(`/clinician/patients/${parsed.data.patientId}`);
  if (data === false) return { ok: false, message: "It was already settled, so there was nothing to withdraw." };
  return { ok: true, message: "Withdrawn. The patient no longer sees it." };
}
