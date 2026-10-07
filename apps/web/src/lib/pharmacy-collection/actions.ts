"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { chooseFormSchema, noticeForError, prescriptionOnlySchema, type Notice } from "./model";

const page = (rx: string, n: Notice): never => redirect(`/patient/pharmacy/collect/${rx}?n=${n}`);

/**
 * S28: the patient chooses a verified pharmacy to collect from. Runs as the signed-in patient (never the service role);
 * public.patient_choose_pharmacy is the only writer and refuses a prescription that is not hers, a pharmacy that is not verified and
 * active, and a change after the pharmacy has started to supply. The code is read back on the page, not carried in the address.
 */
export async function choosePharmacyAction(formData: FormData): Promise<void> {
  const parsed = chooseFormSchema.safeParse({ prescription: formData.get("prescription"), partner: formData.get("partner"), location: formData.get("location") });
  if (!parsed.success) {
    const rx = String(formData.get("prescription") ?? "");
    return prescriptionOnlySchema.safeParse({ prescription: rx }).success ? page(rx, "failed") : redirect("/patient");
  }
  const { error } = await loose(await createClient()).rpc("patient_choose_pharmacy", {
    p_prescription: parsed.data.prescription,
    p_partner: parsed.data.partner,
    p_location: parsed.data.location,
  });
  return page(parsed.data.prescription, error ? noticeForError(error.message) : "chosen");
}

/** A new code when the old one is locked or expired. The old code stops working at once. */
export async function newCodeAction(formData: FormData): Promise<void> {
  const parsed = prescriptionOnlySchema.safeParse({ prescription: formData.get("prescription") });
  if (!parsed.success) return redirect("/patient");
  const { error } = await loose(await createClient()).rpc("patient_new_collection_code", { p_prescription: parsed.data.prescription });
  return page(parsed.data.prescription, error ? noticeForError(error.message) : "new_code");
}
