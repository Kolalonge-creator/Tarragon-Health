"use client";

import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { confirmLabResultExtractionAction } from "@/lib/lab-extraction/actions";
import type { ProposedReading } from "@/lib/lab-extraction/analytes";

export interface LabResultExtraction {
  id: string;
  documentId: string;
  status: string;
  modelId: string | null;
  proposed: ProposedReading[];
  errorMessage: string | null;
  confirmedAt: string | null;
  createdAt: string;
  documentFilename: string | null;
}

const key = (patientId: string) => ["lab-extractions", patientId];

/**
 * Extractions awaiting a clinician's check for one patient.
 *
 * Org-staff only by RLS (lab_result_extractions_select) — a patient must never
 * see an unconfirmed machine reading of their own blood test.
 */
export function usePendingLabExtractions(patientId: string) {
  return useQuery({
    queryKey: key(patientId),
    queryFn: async (): Promise<LabResultExtraction[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("lab_result_extractions")
        .select(
          "id, document_id, status, model_id, proposed, error_message, confirmed_at, created_at, document:lab_result_documents!lab_result_extractions_document_id_fkey(original_filename)",
        )
        .eq("patient_id", patientId)
        .is("confirmed_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        documentId: row.document_id,
        status: row.status,
        modelId: row.model_id,
        proposed: Array.isArray(row.proposed) ? (row.proposed as unknown as ProposedReading[]) : [],
        errorMessage: row.error_message,
        confirmedAt: row.confirmed_at,
        createdAt: row.created_at,
        documentFilename: row.document?.original_filename ?? null,
      }));
    },
    enabled: !!patientId,
  });
}

export function useConfirmLabExtraction(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      extractionId: string;
      readings: { code: string; value: number; takenOn?: string | null }[];
    }) => {
      const result = await confirmLabResultExtractionAction(input);
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key(patientId) });
      // Confirmed values land in lab_analyte_readings, which is what the trend
      // and lipid surfaces read.
      queryClient.invalidateQueries({ queryKey: ["lab-analytes", patientId] });
      queryClient.invalidateQueries({ queryKey: ["lipids", patientId] });
    },
  });
}
