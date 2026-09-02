import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type VerifiedDocument = Tables<"verified_documents">;

export type VerifiedDocumentWithPatient = VerifiedDocument & {
  patient: { full_name: string | null; patient_number: string | null } | null;
};

export const verifiedDocumentKeys = {
  mine: (patientId: string) => ["verified-documents", "mine", patientId] as const,
  org: ["verified-documents", "org"] as const,
};

export function useMyVerifiedDocuments(patientId: string) {
  return useQuery({
    queryKey: verifiedDocumentKeys.mine(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("verified_documents")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as VerifiedDocument[];
    },
  });
}

/** Patient requests a document — verified_documents_enforce_credit (the DB
 * trigger) redeems one verified_document_credit or rejects the insert. */
export function useRequestVerifiedDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      patientId,
      organisationId,
      documentType,
      requestNote,
    }: {
      patientId: string;
      organisationId: string;
      documentType: "fit_to_work" | "travel_health_certificate";
      requestNote?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("verified_documents").insert({
        patient_id: patientId,
        organisation_id: organisationId,
        document_type: documentType,
        request_note: requestNote || null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: verifiedDocumentKeys.mine(variables.patientId) });
    },
  });
}

/** Doctor-side worklist. */
export function useOrgVerifiedDocumentRequests() {
  return useQuery({
    queryKey: verifiedDocumentKeys.org,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("verified_documents")
        .select(
          "*, patient:profiles!verified_documents_patient_id_fkey(full_name, patient_number)"
        )
        .eq("status", "requested")
        .order("sla_due_at", { ascending: true });
      if (error) throw error;
      return data as VerifiedDocumentWithPatient[];
    },
  });
}

/** Doctor issues or declines. Issuing requires attestation_text + validFrom
 * (verified_documents_issued_has_attestation enforces it server-side too). */
export function useDecideVerifiedDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input:
        | {
            documentId: string;
            decision: "issued";
            attestationText: string;
            validFrom: string;
            validUntil?: string;
          }
        | { documentId: string; decision: "declined"; declinedReason?: string }
    ) => {
      const supabase = createClient();
      const payload =
        input.decision === "issued"
          ? {
              status: "issued" as const,
              attestation_text: input.attestationText,
              valid_from: input.validFrom,
              valid_until: input.validUntil || null,
            }
          : { status: "declined" as const, declined_reason: input.declinedReason || null };
      const { error } = await supabase
        .from("verified_documents")
        .update(payload)
        .eq("id", input.documentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: verifiedDocumentKeys.org });
    },
  });
}
