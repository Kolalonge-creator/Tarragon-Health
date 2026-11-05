"use server";

import { prepareUpload } from "@/lib/uploads/prepare-upload";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { RESULT_DOC_BUCKET } from "@/lib/lab-results/documents";
import { validateResultDocFile } from "@/lib/validation/lab-result-documents";
import { verifyResultDocSignature } from "@/lib/validation/result-doc-signature";
import { fileSha256 } from "@/lib/clinical-documents/fingerprint";
import { DUPLICATE_DOCUMENT_MESSAGE, isDuplicateDocumentError } from "@/lib/clinical-documents/duplicate";
import { runDocumentClassification, startReader } from "@/lib/clinical-documents/classify-run";

/**
 * "Not sure what this is?" (clinical document engine step 4). A patient uploads a health document for themselves without choosing
 * its type; the platform suggests one (rules, then AI-024 when it is switched on) and asks the patient whenever it is not sure.
 * Only for the signed-in patient's own record: a caregiver viewing someone else's record does not get this form.
 */

export type UnsortedUploadResult =
  | { ok: true; outcome: "sorted_lab" | "sorted_other" | "question" | "saved" }
  | { ok: false; error: string };

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

const noteSchema = z
  .string()
  .trim()
  .max(500, "Keep the note under 500 characters.")
  .optional()
  .transform((v) => (v ? v : undefined));

export async function uploadUnsortedDocument(formData: FormData): Promise<UnsortedUploadResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Attach the document (PDF or photo)." };
  const fileError = validateResultDocFile(file);
  if (fileError) return { ok: false, error: fileError };
  const signatureError = await verifyResultDocSignature(file);
  if (signatureError) return { ok: false, error: signatureError };
  const note = noteSchema.safeParse(formData.get("note") ?? undefined);
  if (!note.success) return { ok: false, error: note.error.issues[0]?.message ?? "Check the note." };

  const supabase = await createClient();
  const contentSha256 = await fileSha256(file);
  // The leading folder must be the caller's own id: the bucket's own-folder policy checks it, and so does the database function.
  const path = `${user.id}/${randomUUID()}.${EXT_BY_MIME[file.type] ?? "bin"}`;
  // Bytes must match the declared type, and photo location data is removed (security audit 2026-11-05, M-4/L-4).
  const prepared = await prepareUpload(file);
  if (!prepared.ok) return { ok: false, error: prepared.error };
  const { error: uploadError } = await supabase.storage
    .from(RESULT_DOC_BUCKET)
    .upload(path, prepared.upload.body, { contentType: prepared.upload.contentType, upsert: false });
  if (uploadError) return { ok: false, error: "The file could not be stored. Please try again." };

  const { data: documentId, error } = await supabase.rpc("submit_unsorted_document", {
    p_file_path: path,
    p_original_filename: file.name.slice(0, 200),
    p_mime_type: file.type,
    p_file_size_bytes: file.size,
    p_content_sha256: contentSha256,
    p_note: (note.data ?? null) as string,
  });
  if (error || !documentId) {
    await supabase.storage.from(RESULT_DOC_BUCKET).remove([path]);
    if (isDuplicateDocumentError(error)) return { ok: false, error: DUPLICATE_DOCUMENT_MESSAGE };
    if (error?.message?.includes("only a patient")) return { ok: false, error: "Only the account holder can upload here." };
    return { ok: false, error: "Could not save that upload. Please try again." };
  }

  // Awaited, as the lab upload awaits its reader: the patient sees the outcome (sorted, or one question) when the page refreshes.
  const { pipeline, asked } = await runDocumentClassification(createServiceRoleClient(), documentId);
  if (pipeline === "lab") await linkConsultCredit(supabase, user.id, documentId);
  revalidatePath("/patient/labs");
  // No pipeline and not asked: sorting did not finish (an error). The upload is saved; the daily sweep finishes it.
  return { ok: true, outcome: pipeline === "lab" ? "sorted_lab" : pipeline ? "sorted_other" : asked ? "question" : "saved" };
}

/**
 * Same best-effort step as the direct lab upload (uploadResultDocumentAsPatient): a doctor walkthrough the patient already paid
 * for is linked to the lab document this upload became. Never blocks: with nothing to claim, nothing happens.
 */
async function linkConsultCredit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  patientId: string,
  clinicalDocumentId: string,
): Promise<void> {
  try {
    const { data: cd } = await supabase
      .from("clinical_documents")
      .select("routed_table, routed_id")
      .eq("id", clinicalDocumentId)
      .maybeSingle();
    if (cd?.routed_table !== "lab_result_documents" || !cd.routed_id) return;
    const { data: claimed, error } = await supabase.rpc("claim_lab_result_consult_credit", {
      p_patient_id: patientId,
      p_lab_order_id: null as unknown as string,
    });
    if (error) throw error;
    if (claimed) await supabase.rpc("settle_lab_result_consult_claim", { p_request_id: claimed, p_document_id: cd.routed_id });
  } catch (error) {
    console.error("unsorted documents: could not link a consult-fee credit (non-blocking)", error);
  }
}

const confirmSchema = z.object({
  documentId: z.string().uuid(),
  kindCode: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/).max(80),
});

export async function confirmDocumentKind(input: { documentId: string; kindCode: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a type from the list." };

  const supabase = await createClient();
  const { data: pipeline, error } = await supabase.rpc("confirm_clinical_document_kind", {
    p_document: parsed.data.documentId,
    p_kind: parsed.data.kindCode,
  });
  if (error) {
    if (error.message.includes("already_routed")) return { ok: false, error: "This document has already been sorted." };
    if (error.message.includes("kind_not_specific")) return { ok: false, error: "Choose a more specific type." };
    return { ok: false, error: "Could not save your answer. Please try again." };
  }
  if (pipeline === "lab") await linkConsultCredit(supabase, user.id, parsed.data.documentId);
  if (pipeline) await startReader(createServiceRoleClient(), parsed.data.documentId, pipeline);
  revalidatePath("/patient/labs");
  return { ok: true };
}
