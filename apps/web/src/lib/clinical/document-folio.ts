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

/** The caller may not read this document; a visible refusal, never a document silently printed without a number. */
export class DocumentFolioRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentFolioRefusedError";
  }
}

/** Which directory column identifies the clinician for each document kind (profile id or staff id). */
const CLINICIAN_KEY: Record<DocumentFolioKind, "profile_id" | "id"> = {
  referral_letter: "profile_id",
  lab_result_interpretation: "profile_id",
  verified_document: "id",
  prescription: "profile_id",
  lab_request: "id",
  vaccination_certificate: "profile_id",
};
const ACTIVE_ONLY: ReadonlySet<DocumentFolioKind> = new Set([
  "referral_letter",
  "lab_result_interpretation",
  "vaccination_certificate",
]);

// The generated types may lag the migration on a branch; keep the call typed locally.
type RpcClient = {
  rpc: (
    fn: "clinician_folio_for_document",
    args: { p_document_kind: DocumentFolioKind; p_document_ids: string[] },
  ) => PromiseLike<{
    data:
      | {
          document_id: string;
          clinician_staff_id: string | null;
          clinician_profile_id: string | null;
          full_name: string | null;
          credential_type: string | null;
          credential_number: string | null;
        }[]
      | null;
    error: { message: string; code?: string } | null;
  }>;
};

function isMissingFunction(error: { message: string; code?: string }): boolean {
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    error.message.includes("Could not find the function")
  );
}

type DirectoryReader = {
  from: (table: "clinical_staff_directory") => {
    select: (cols: string) => {
      in: (col: string, values: string[]) => PromiseLike<{
        data: Record<string, string | boolean | null>[] | null;
        error: { message: string } | null;
      }>;
    };
  };
};

/**
 * REMOVE IN STEP 2. Deploy-window fallback: the app can reach production before the migration that creates
 * clinician_folio_for_document. While the directory view still carries credential_number (step 1 only), read
 * the clinician's folio from it so no document breaks. Step 2 removes that column, and this function with it.
 */
async function foliosFromDirectoryView(
  supabase: unknown,
  kind: DocumentFolioKind,
  clinicianByDocument: Record<string, string | null | undefined>,
): Promise<Map<string, DocumentFolio>> {
  const out = new Map<string, DocumentFolio>();
  const ids = Array.from(new Set(Object.values(clinicianByDocument).filter((v): v is string => !!v)));
  if (ids.length === 0) return out;
  const key = CLINICIAN_KEY[kind];
  const { data, error } = await (supabase as DirectoryReader)
    .from("clinical_staff_directory")
    .select("id, profile_id, full_name, credential_type, credential_number, active")
    .in(key, ids);
  if (error) throw new Error(`clinician folio fallback failed: ${error.message}`);
  const byClinician = new Map<string, Record<string, string | boolean | null>>();
  for (const row of data ?? []) {
    if (ACTIVE_ONLY.has(kind) && row.active !== true) continue;
    const k = row[key];
    if (typeof k === "string") byClinician.set(k, row);
  }
  for (const [documentId, clinicianId] of Object.entries(clinicianByDocument)) {
    const row = clinicianId ? byClinician.get(clinicianId) : undefined;
    if (!row) continue;
    out.set(documentId, {
      documentId,
      clinicianStaffId: String(row.id),
      clinicianProfileId: (row.profile_id as string | null) ?? null,
      fullName: (row.full_name as string | null) ?? null,
      credentialType: (row.credential_type as string | null) ?? null,
      credentialNumber: (row.credential_number as string | null) ?? null,
    });
  }
  return out;
}

/**
 * @param clinicianByDocument document id -> the clinician id the generator already holds (profile id or staff id per
 *   kind). Used only by the step-1 deploy-window fallback (REMOVE IN STEP 2).
 */
export async function fetchDocumentFolios(
  supabase: Pick<SupabaseClient, "rpc"> | RpcClient,
  kind: DocumentFolioKind,
  documentIds: string[],
  clinicianByDocument: Record<string, string | null | undefined> = {},
): Promise<Map<string, DocumentFolio>> {
  const out = new Map<string, DocumentFolio>();
  if (documentIds.length === 0) return out;
  const { data, error } = await (supabase as RpcClient).rpc("clinician_folio_for_document", {
    p_document_kind: kind,
    p_document_ids: documentIds,
  });
  if (error) {
    if (isMissingFunction(error)) {
      // REMOVE IN STEP 2
      console.warn("clinician_folio_for_document is not deployed yet; reading the folio from the directory view");
      return foliosFromDirectoryView(supabase, kind, clinicianByDocument);
    }
    if ((error as { code?: string }).code === "42501") {
      throw new DocumentFolioRefusedError("not entitled to the clinician folio for this document");
    }
    throw new Error(`clinician_folio_for_document failed: ${error.message}`);
  }
  for (const row of data ?? []) {
    if (row.clinician_staff_id === null) continue; // entitled, but no staff row backs this document's clinician
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
