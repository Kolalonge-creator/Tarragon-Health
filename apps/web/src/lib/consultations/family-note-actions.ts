"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { familyNoteInputSchema, type FamilyNoteResult } from "./family-note";

/**
 * A doctor saves one short line for the patient's family after a finished consultation (2026-11-03). Runs as the doctor's own session:
 * public.write_family_note is SECURITY INVOKER, so the family_doctor_notes RLS policy decides (the doctor who held this patient's
 * completed consultation, recently, in the patient's organisation; never a coordinator). A correction is a new row; nothing is edited.
 * Returns a short code, never a database message.
 */
export async function saveFamilyNoteAction(input: unknown): Promise<FamilyNoteResult> {
  const parsed = familyNoteInputSchema.safeParse(input);
  if (!parsed.success) {
    const tooLong = parsed.error.issues.some((i) => i.code === "too_big");
    return { ok: false, reason: tooLong ? "too_long" : "invalid" };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "signed_out" };
  const { error } = await supabase.rpc("write_family_note", { p_encounter: parsed.data.encounterId, p_body: parsed.data.body });
  if (error) {
    // 42501 is the policy saying no; 23502 is "you have no active clinical staff record"; 23514 is the length check
    if (error.code === "42501" || error.code === "23502") return { ok: false, reason: "not_allowed" };
    if (error.code === "23514") return { ok: false, reason: "too_long" };
    return { ok: false, reason: "failed" };
  }
  revalidatePath(`/clinician/consultation/${parsed.data.encounterId}`);
  return { ok: true };
}
