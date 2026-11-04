"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { filePathologyReportSchema } from "@/lib/validation/pathology-reports";

/**
 * A doctor files a pathology, cytology, cervical screening or HPV result AS PRINTED from a patient's kept document (clinical document
 * engine step 5b). public.file_pathology_report checks the caller is an active clinician who may read the record in the document's
 * category, that the result type matches the document, and records the doctor's review of the document in the same step.
 */
export async function filePathologyReport(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const parsed = filePathologyReportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const { documentId, patientId, note, ...fields } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("file_pathology_report", { p_document: documentId, p_fields: fields, p_note: note });
  if (error) {
    if (error.message.includes("kind_does_not_match")) return { ok: false, error: "That result type does not match this document." };
    if (error.message.includes("not_fileable")) return { ok: false, error: "This document has already been reviewed." };
    return { ok: false, error: "Could not file the result. Please try again." };
  }
  revalidatePath(`/clinician/patients/${patientId}`);
  return { ok: true };
}
