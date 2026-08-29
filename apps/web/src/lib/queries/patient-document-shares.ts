import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Enums, Tables } from "@tarragon/shared";

export type DocumentShareRecipientType = Enums<"document_share_recipient_type">;

export interface PatientDocumentShare {
  id: string;
  documentId: string;
  recipientType: DocumentShareRecipientType;
  recipientProfileId: string | null;
  /** Name of the recipient's Tarragon account, when recipient_profile_id is set. */
  recipientProfileName: string | null;
  recipientName: string | null;
  recipientOrganisation: string | null;
  purpose: string;
  sharedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

function queryKeyFor(documentId: string) {
  return ["patient-document-shares", documentId] as const;
}

/**
 * Shares on one document, newest first — active and revoked alike, so the
 * caller can render a full authorisation history rather than only what is
 * live right now. Whether a share is still active (not revoked, not expired)
 * is left for the caller to compute from revokedAt/expiresAt, matching how
 * useMyCareFollowers leaves permissionLevel interpretation to its caller.
 */
export function usePatientDocumentShares(documentId: string) {
  return useQuery({
    queryKey: queryKeyFor(documentId),
    queryFn: async (): Promise<PatientDocumentShare[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_document_shares")
        .select(
          `id, document_id, recipient_type, recipient_profile_id, recipient_name,
           recipient_organisation, purpose, shared_at, expires_at, revoked_at,
           recipient_profile:profiles!patient_document_shares_recipient_profile_id_fkey(full_name)`
        )
        .eq("document_id", documentId)
        .order("shared_at", { ascending: false });
      if (error) throw error;

      return (data ?? []).map((row) => ({
        id: row.id,
        documentId: row.document_id,
        recipientType: row.recipient_type,
        recipientProfileId: row.recipient_profile_id,
        recipientProfileName: row.recipient_profile?.full_name ?? null,
        recipientName: row.recipient_name,
        recipientOrganisation: row.recipient_organisation,
        purpose: row.purpose,
        sharedAt: row.shared_at,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
      }));
    },
    enabled: !!documentId,
  });
}

export interface CreatePatientDocumentShareInput {
  documentId: string;
  recipientType: DocumentShareRecipientType;
  /**
   * An existing Tarragon account id. This is a plain text field on the form
   * for now — a proper "search your care team" picker (by name/phone) is a
   * real UX gap but out of scope for this pass; follow-up work.
   */
  recipientProfileId?: string | null;
  recipientName?: string | null;
  recipientOrganisation?: string | null;
  purpose: string;
  expiresAt?: string | null;
}

/**
 * Create a new share. organisation_id/patient_id are never taken from the
 * caller — they are read back from the document row itself (readable to the
 * caller only if patient_documents_select already allows it, i.e. the caller
 * owns the document or acts for its owner), the same "derive from the
 * session/DB, never trust a client-passed value" rule care-access.ts follows
 * for its own mutations.
 */
export function useCreatePatientDocumentShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePatientDocumentShareInput): Promise<void> => {
      const purpose = input.purpose.trim();
      if (!purpose) throw new Error("Say why you're sharing this document.");
      if (!input.recipientProfileId && !input.recipientName && !input.recipientOrganisation) {
        throw new Error(
          "Add who you're sharing this with — an account, a name, or an organisation."
        );
      }

      const supabase = createClient();
      const { data: document, error: documentError } = await supabase
        .from("patient_documents")
        .select("id, patient_id, organisation_id")
        .eq("id", input.documentId)
        .single();
      if (documentError || !document) {
        throw new Error("That document could not be found, or you don't have access to it.");
      }

      const { error } = await supabase.from("patient_document_shares").insert({
        organisation_id: document.organisation_id,
        document_id: document.id,
        patient_id: document.patient_id,
        recipient_type: input.recipientType,
        recipient_profile_id: input.recipientProfileId?.trim() || null,
        recipient_name: input.recipientName?.trim() || null,
        recipient_organisation: input.recipientOrganisation?.trim() || null,
        purpose,
        expires_at: input.expiresAt || null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeyFor(variables.documentId) });
    },
  });
}

/**
 * Revoke one share. The row-level trigger derives revoked_at/revoked_by from
 * the session and freezes every other column, regardless of what else this
 * update sends — so only a truthy revoked_at needs to travel from here.
 */
export function useRevokePatientDocumentShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { shareId: string; documentId: string }): Promise<void> => {
      const supabase = createClient();
      const { error } = await supabase
        .from("patient_document_shares")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", input.shareId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeyFor(variables.documentId) });
    },
  });
}

export type PatientDocumentShareRow = Tables<"patient_document_shares">;
