import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

const RESULT_DOC_BUCKET = "lab-result-documents";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

/**
 * A patient uploads their OWN lab result document. The file goes to the private
 * 'lab-result-documents' bucket under the caller's own uid folder (storage RLS),
 * then a row is inserted through the patient's own RLS-scoped session with
 * source='patient'. The insert trigger flags it for clinician review; because
 * the patient uploaded it themselves, no patient notification is queued.
 *
 * `screeningCompletionId` links this upload back to a self-reported
 * screening_completions row (see useLogScreeningCompletion) when the patient
 * uploads right after confirming a screening was done — optional, since this
 * hook is also used for the general "upload any result" flow with no such
 * confirmation. The insert policy re-verifies the id belongs to this patient
 * server-side, so a forged id from the client is rejected, not just ignored.
 *
 * Mirrors useAttachVaccinationCertificate — never a public URL, viewed later via
 * a short-lived signed URL.
 */
export function useUploadOwnResultDocument() {
  return useMutation({
    mutationFn: async (input: {
      file: File;
      note?: string;
      screeningCompletionId?: string;
    }): Promise<void> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data: profile } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", user.id)
        .single();
      if (!profile?.organisation_id) {
        throw new Error("Your account isn't linked to an organisation yet.");
      }

      const ext = EXT_BY_MIME[input.file.type] ?? "bin";
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(RESULT_DOC_BUCKET)
        .upload(path, input.file, { contentType: input.file.type, upsert: false });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from("lab_result_documents").insert({
        organisation_id: profile.organisation_id,
        patient_id: user.id,
        file_path: path,
        original_filename: input.file.name,
        mime_type: input.file.type,
        file_size_bytes: input.file.size,
        source: "patient",
        note: input.note?.trim() || null,
        screening_completion_id: input.screeningCompletionId ?? null,
      });
      if (insertError) {
        await supabase.storage.from(RESULT_DOC_BUCKET).remove([path]);
        throw insertError;
      }
    },
  });
}

/**
 * Org-staff reconciliation action (module 57.12/57.13): attach an uploaded
 * result document that arrived with no order link to the lab_order it
 * belongs to. lab_order_id was already a plain, staff-updatable column — RLS
 * (lab_result_documents_update) and private.enforce_lab_result_document_update
 * both already permit this write, so no new server surface was needed, only
 * this client-side mutation and the worklist that calls it.
 */
export function useMatchResultDocumentToOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ documentId, labOrderId }: { documentId: string; labOrderId: string }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("lab_result_documents")
        .update({ lab_order_id: labOrderId })
        .eq("id", documentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["result-documents-unmatched"] });
      queryClient.invalidateQueries({ queryKey: ["lab-orders"] });
    },
  });
}

/**
 * Org-staff amendment action (module 57.14): mark this document as the
 * corrected/amended replacement for an earlier one. The original stays
 * visible and traceable — private.enforce_lab_result_document_update stamps
 * its superseded_by_document_id/superseded_at server-side; this never
 * deletes or hides anything.
 */
export function useMarkResultDocumentSupersedes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      documentId,
      supersedesDocumentId,
    }: {
      documentId: string;
      /** Pass null to undo a mistaken link. */
      supersedesDocumentId: string | null;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("lab_result_documents")
        .update({ supersedes_document_id: supersedesDocumentId })
        .eq("id", documentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["result-documents"] });
    },
  });
}
