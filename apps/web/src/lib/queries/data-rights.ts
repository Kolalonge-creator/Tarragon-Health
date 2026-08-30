import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type DataDeletionRequest = Tables<"data_deletion_requests">;
export type DataCorrectionRequest = Tables<"data_correction_requests">;

function deletionKey(patientId: string) {
  return ["data-deletion-requests", patientId];
}

function correctionKey(patientId: string) {
  return ["data-correction-requests", patientId];
}

/**
 * The caller's own deletion requests, newest first. RLS already scopes this
 * to patient_id = auth.uid() OR admin — this hook is only ever used from
 * the patient's own Privacy Centre, so patientId is just the query key.
 */
export function usePatientDeletionRequests(patientId: string) {
  return useQuery({
    queryKey: deletionKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("data_deletion_requests")
        .select("*")
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return data as DataDeletionRequest[];
    },
    enabled: !!patientId,
  });
}

/**
 * Opens a new deletion request, §87.11. organisation_id/patient_id/status
 * are all forced server-side, unconditionally, by
 * private.enforce_data_deletion_request_attribution — this is a tracked
 * review workflow, not an auto-delete: nothing is actually removed until an
 * admin reviews it (see data-governance docs).
 */
export function useCreateDeletionRequest(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { reason: string; requestedCategories: string[] }) => {
      const supabase = createClient();
      const { error } = await supabase.from("data_deletion_requests").insert({
        reason: input.reason,
        requested_categories: input.requestedCategories,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: deletionKey(patientId) });
    },
  });
}

/** The caller's own correction requests, newest first. Same RLS shape as deletion requests. */
export function usePatientCorrectionRequests(patientId: string) {
  return useQuery({
    queryKey: correctionKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("data_correction_requests")
        .select("*")
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return data as DataCorrectionRequest[];
    },
    enabled: !!patientId,
  });
}

/**
 * Opens a new rectification request, §87.9. organisation_id/patient_id/
 * status are forced server-side, unconditionally, by private.enforce_
 * data_correction_request_attribution — a request only ever describes
 * what's wrong; the actual correction (if approved) stays a reviewed
 * clinical write elsewhere.
 */
export function useCreateCorrectionRequest(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      recordDescription: string;
      whatIsWrong: string;
      requestedChange?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("data_correction_requests").insert({
        record_description: input.recordDescription,
        what_is_wrong: input.whatIsWrong,
        requested_change: input.requestedChange || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: correctionKey(patientId) });
    },
  });
}
