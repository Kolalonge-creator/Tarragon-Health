import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/**
 * A patient's own lab-result upload — from the general "result documents"
 * list, an open order, or a confirmed screening completion — goes through
 * PatientResultUpload (components/patient-result-upload.tsx) and the
 * uploadResultDocumentAsPatient server action, not a hook in this file.
 *
 * A plain client-side mutation used to live here (useUploadOwnResultDocument,
 * inserting into lab_result_documents directly from the browser). It predated
 * the 2026-08-30 consultation-fee gate and was never updated when that gate
 * landed, so it silently bypassed both the fee and runLabReportExtraction for
 * every upload routed through it — removed in favour of the one gated, AI-
 * extracted action every other patient upload already used.
 */

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
