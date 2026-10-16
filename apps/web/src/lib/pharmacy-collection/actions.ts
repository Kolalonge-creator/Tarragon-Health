"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { chooseFormSchema, noticeForError, prescriptionOnlySchema, suggestionFormSchema, visitChoice, type Notice } from "./model";

/** `forWhom` is set only while a caregiver acts for the patient; it rides in the address so a refresh keeps the same person. */
const page = (rx: string, n: Notice, forWhom?: string): never => redirect(`/patient/pharmacy/collect/${rx}?n=${n}${forWhom ? `&for=${forWhom}` : ""}`);
const beneficiary = (forWhom: string | undefined) => (forWhom ? { p_beneficiary: forWhom } : {});

/**
 * S28: the patient chooses a verified pharmacy to collect from. Runs as the signed-in patient (never the service role);
 * public.patient_choose_pharmacy is the only writer and refuses a prescription that is not hers, a pharmacy that is not verified and
 * active, and a change after the pharmacy has started to supply. The code is read back on the page, not carried in the address.
 * A caregiver with the pharmacy permission may do this for the patient (`for`): the database checks the permission, tells the patient and records who acted.
 */
export async function choosePharmacyAction(formData: FormData): Promise<void> {
  // S28e (OQ-275): the list is one form with a `choice` button per pharmacy and a tick box (`also`) per other waiting prescription. With ticks, every
  // prescription goes in one call and the pharmacy gets one code for the visit. With none, it is the same single door as before.
  const choice = formData.get("choice");
  if (choice !== null) {
    const forWhom = typeof formData.get("for") === "string" && formData.get("for") ? String(formData.get("for")) : undefined;
    const many = visitChoice({ prescription: formData.get("prescription"), choice, also: formData.getAll("also") });
    const rx = String(formData.get("prescription") ?? "");
    const forParsed = prescriptionOnlySchema.safeParse({ prescription: rx, for: forWhom });
    if (!forParsed.success) return redirect("/patient");
    if (many === "too_many") return page(rx, "visit_size_invalid", forParsed.data.for);   // the size message, not a generic failure
    if (!many) return page(rx, "failed", forParsed.data.for);
    if (many.also.length === 0) {
      const { error } = await loose(await createClient()).rpc("patient_choose_pharmacy", {
        p_prescription: many.prescription, p_partner: many.partner, p_location: many.location, ...beneficiary(forParsed.data.for),
      });
      return page(many.prescription, error ? noticeForError(error.message) : "chosen", forParsed.data.for);
    }
    const { error } = await loose(await createClient()).rpc("patient_choose_pharmacy_for_visit", {
      p_prescriptions: [many.prescription, ...many.also], p_partner: many.partner, p_location: many.location, ...beneficiary(forParsed.data.for),
    });
    return page(many.prescription, error ? noticeForError(error.message) : "chosen_many", forParsed.data.for);
  }
  const parsed = chooseFormSchema.safeParse({
    prescription: formData.get("prescription"), partner: formData.get("partner"), location: formData.get("location"), for: formData.get("for") || undefined,
  });
  if (!parsed.success) {
    const rx = String(formData.get("prescription") ?? "");
    return prescriptionOnlySchema.safeParse({ prescription: rx }).success ? page(rx, "failed") : redirect("/patient");
  }
  const { error } = await loose(await createClient()).rpc("patient_choose_pharmacy", {
    p_prescription: parsed.data.prescription,
    p_partner: parsed.data.partner,
    p_location: parsed.data.location,
    ...beneficiary(parsed.data.for),
  });
  return page(parsed.data.prescription, error ? noticeForError(error.message) : "chosen", parsed.data.for);
}

/** A new code when the old one is locked or expired. The old code stops working at once. */
export async function newCodeAction(formData: FormData): Promise<void> {
  const parsed = prescriptionOnlySchema.safeParse({ prescription: formData.get("prescription"), for: formData.get("for") || undefined });
  if (!parsed.success) return redirect("/patient");
  const supabase = loose(await createClient());
  // Someone acting for the patient is not shown whether this prescription was sent together with others (those reads are the patient's own), so for her a
  // new code renews the whole visit when there is one, instead of quietly splitting this prescription out of it. A prescription sent alone has no visit
  // and falls through to its own new code.
  if (parsed.data.for) {
    const visit = await supabase.rpc("patient_new_visit_code", { p_prescription: parsed.data.prescription, ...beneficiary(parsed.data.for) });
    if (!visit.error) return page(parsed.data.prescription, "new_code", parsed.data.for);
    if (!(visit.error.message ?? "").includes("collection_not_open")) return page(parsed.data.prescription, noticeForError(visit.error.message), parsed.data.for);
  }
  const { error } = await supabase.rpc("patient_new_collection_code", { p_prescription: parsed.data.prescription, ...beneficiary(parsed.data.for) });
  return page(parsed.data.prescription, error ? noticeForError(error.message) : "new_code", parsed.data.for);
}

/**
 * S28e: a new code for the whole visit when several medicines were sent together (the old code stops working at once). The single "new code" above is
 * for one prescription and takes it out of its visit; this keeps them together and sends nothing to the pharmacy again.
 */
export async function newVisitCodeAction(formData: FormData): Promise<void> {
  const parsed = prescriptionOnlySchema.safeParse({ prescription: formData.get("prescription"), for: formData.get("for") || undefined });
  if (!parsed.success) return redirect("/patient");
  const { error } = await loose(await createClient()).rpc("patient_new_visit_code", { p_prescription: parsed.data.prescription, ...beneficiary(parsed.data.for) });
  return page(parsed.data.prescription, error ? noticeForError(error.message) : "new_code", parsed.data.for);
}

/** "Take it back": consent to share is revocable. The pharmacy stops seeing the prescription at once and the code stops working. */
export async function withdrawAction(formData: FormData): Promise<void> {
  const parsed = prescriptionOnlySchema.safeParse({ prescription: formData.get("prescription"), for: formData.get("for") || undefined });
  if (!parsed.success) return redirect("/patient");
  const { error } = await loose(await createClient()).rpc("patient_withdraw_from_pharmacy", { p_prescription: parsed.data.prescription, ...beneficiary(parsed.data.for) });
  return page(parsed.data.prescription, error ? noticeForError(error.message) : "withdrawn", parsed.data.for);
}

/**
 * S54c: the patient confirms the pharmacy her care team suggested. This is the same single database door as choosing from the list
 * (patient_accept_pharmacy_suggestion calls patient_choose_pharmacy), so every rule there still applies. Nothing is sent before this.
 */
export async function acceptSuggestionAction(formData: FormData): Promise<void> {
  const parsed = suggestionFormSchema.safeParse({ prescription: formData.get("prescription"), suggestion: formData.get("suggestion") });
  if (!parsed.success) {
    const rx = String(formData.get("prescription") ?? "");
    return prescriptionOnlySchema.safeParse({ prescription: rx }).success ? page(rx, "failed") : redirect("/patient");
  }
  const { error } = await loose(await createClient()).rpc("patient_accept_pharmacy_suggestion", { p_suggestion: parsed.data.suggestion });
  return page(parsed.data.prescription, error ? noticeForError(error.message) : "chosen");
}

/** "No thanks": the suggestion is closed, nothing is sent, and she can still choose any pharmacy or take the prescription anywhere. */
export async function declineSuggestionAction(formData: FormData): Promise<void> {
  const parsed = suggestionFormSchema.safeParse({ prescription: formData.get("prescription"), suggestion: formData.get("suggestion") });
  if (!parsed.success) {
    const rx = String(formData.get("prescription") ?? "");
    return prescriptionOnlySchema.safeParse({ prescription: rx }).success ? page(rx, "failed") : redirect("/patient");
  }
  const { data, error } = await loose(await createClient()).rpc("patient_decline_pharmacy_suggestion", { p_suggestion: parsed.data.suggestion });
  // false means it was already settled (accepted in another tab, withdrawn): never tell her "nothing was sent" in that case
  return page(parsed.data.prescription, error ? "failed" : data === false ? "suggestion_not_open" : "suggestion_declined");
}
