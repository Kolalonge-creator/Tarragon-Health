"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

/**
 * A doctor records the review of a patient-uploaded document that has no automatic reader yet (clinical document engine step 4:
 * an ECG, scan, letter or pathology report sorted by the patient or AI-024). The database function checks the caller is an active
 * clinician who may read this patient's record in the document's category, and that the document is still waiting.
 */
const schema = z.object({
  documentId: z.string().uuid(),
  patientId: z.string().uuid(),
  note: z.string().trim().min(1, "Write what you found, even if it is 'no concern'.").max(2000, "Keep the note under 2,000 characters."),
});

export async function reviewUnsortedDocument(input: { documentId: string; patientId: string; note: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the note." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_clinical_document", { p_document: parsed.data.documentId, p_note: parsed.data.note });
  if (error) {
    if (error.message.includes("not_reviewable_here")) return { ok: false, error: "This document is reviewed from the lab results list." };
    return { ok: false, error: "Could not record the review. Please try again." };
  }
  revalidatePath(`/clinician/patients/${parsed.data.patientId}`);
  return { ok: true };
}
