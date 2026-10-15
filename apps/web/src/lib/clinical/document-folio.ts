import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The issuing clinician's MDCN folio, for documents handed to the patient.
 *
 * CMO decision Q17: the folio is never shown publicly and is no longer exposed by
 * public.clinical_staff_directory (OQ-358). A referral letter or verified document
 * legitimately carries it, so those generators read it through the narrow
 * public.clinician_folio_for_document() function, which derives the clinician from the
 * document and returns a row only when the caller is entitled to that document.
 *
 * A failed lookup throws. Silently printing a signed document with the registration
 * number missing would look like a valid document and is worse than a visible error.
 */
export type DocumentFolioKind =
  | "referral_letter"
  | "lab_result_interpretation"
  | "verified_document"
  | "prescription"
  | "lab_request"
  | "vaccination_certificate";

export interface DocumentFolio {
  documentId: string;
  clinicianStaffId: string;
  clinicianProfileId: string | null;
  fullName: string | null;
  credentialType: string | null;
  credentialNumber: string | null;
}

// The generated types may lag the migration on a branch; keep the call typed locally.
type RpcClient = {
  rpc: (
    fn: "clinician_folio_for_document",
    args: { p_document_kind: DocumentFolioKind; p_document_ids: string[] },
  ) => PromiseLike<{
    data:
      | {
          document_id: string;
          clinician_staff_id: string;
          clinician_profile_id: string | null;
          full_name: string | null;
          credential_type: string | null;
          credential_number: string | null;
        }[]
      | null;
    error: { message: string } | null;
  }>;
};

export async function fetchDocumentFolios(
  supabase: Pick<SupabaseClient, "rpc"> | RpcClient,
  kind: DocumentFolioKind,
  documentIds: string[],
): Promise<Map<string, DocumentFolio>> {
  const out = new Map<string, DocumentFolio>();
  if (documentIds.length === 0) return out;
  const { data, error } = await (supabase as RpcClient).rpc("clinician_folio_for_document", {
    p_document_kind: kind,
    p_document_ids: documentIds,
  });
  if (error) throw new Error(`clinician_folio_for_document failed: ${error.message}`);
  for (const row of data ?? []) {
    out.set(row.document_id, {
      documentId: row.document_id,
      clinicianStaffId: row.clinician_staff_id,
      clinicianProfileId: row.clinician_profile_id,
      fullName: row.full_name,
      credentialType: row.credential_type,
      credentialNumber: row.credential_number,
    });
  }
  return out;
}
