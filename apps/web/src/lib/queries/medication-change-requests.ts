import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import type {
  RequestMedicationChangeInput,
  ReviewMedicationChangeRequestInput,
} from "@/lib/validation/medications";

export type MedicationChangeRequest = Tables<"medication_change_requests">;

/**
 * A patient's proposed change to an existing medication + why, and its
 * clinical review — see 20260907131424_medication_change_requests.sql for
 * why there is no auto-apply path: approving here only records that a
 * clinician has reviewed the request, the actual edit still goes through
 * the existing Amend control (private.amend_medication).
 */

function medicationChangeRequestsKey(patientId: string) {
  return ["medication-change-requests", patientId];
}

/** All of a patient's own change requests, newest first — enough to show
 * "change requested, awaiting review" against the medication it's for. */
export function useMedicationChangeRequests(patientId: string) {
  return useQuery({
    queryKey: medicationChangeRequestsKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medication_change_requests")
        .select("*")
        .eq("patient_id", patientId)
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return data as MedicationChangeRequest[];
    },
    enabled: !!patientId,
  });
}

/** Patient requests a change to an existing medication, with a reason. */
export function useRequestMedicationChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      medicationId,
      patientId,
      input,
    }: {
      medicationId: string;
      patientId: string;
      input: RequestMedicationChangeInput;
    }) => {
      const supabase = createClient();
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", patientId)
        .single();
      if (profileError) throw profileError;
      if (!profile?.organisation_id) {
        throw new Error("This patient has no organisation on file");
      }
      // organisation_id/patient_id are re-derived server-side from the
      // medication row regardless of what's sent here — supplied only to
      // satisfy the NOT NULL columns (same convention as
      // useRequestMedicationRepeat).
      const { error } = await supabase.from("medication_change_requests").insert({
        medication_id: medicationId,
        patient_id: patientId,
        organisation_id: profile.organisation_id,
        requested_change: input.requested_change,
        reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: medicationChangeRequestsKey(variables.patientId) });
    },
  });
}

/**
 * Pending change requests for a patient, with enough of the medication
 * attached to review the request without a second lookup — scoped per-patient
 * like MedicationRepeatRequestsPanel, not a cross-patient queue.
 */
export function usePendingMedicationChangeRequests(patientId: string) {
  return useQuery({
    queryKey: [...medicationChangeRequestsKey(patientId), "pending"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medication_change_requests")
        .select("*, medication:medications(drug_name, dose, frequency, rx_number)")
        .eq("patient_id", patientId)
        .eq("status", "pending")
        .order("requested_at", { ascending: true });
      if (error) throw error;
      return data as (MedicationChangeRequest & {
        medication: {
          drug_name: string;
          dose: string | null;
          frequency: string | null;
          rx_number: string | null;
        } | null;
      })[];
    },
    enabled: !!patientId,
  });
}

/**
 * Approve/deny a change request. RLS + the review trigger
 * (private.stamp_medication_change_request_review) are the real authority
 * gate — private.has_prescribing_authority, the same full authority
 * amend_medication itself requires — and stamp reviewed_by/reviewed_at
 * server-side; this hook never sends either.
 */
export function useReviewMedicationChangeRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      requestId,
      input,
    }: {
      requestId: string;
      patientId: string;
      input: ReviewMedicationChangeRequestInput;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("medication_change_requests")
        .update({
          status: input.status,
          denial_reason: input.status === "denied" ? input.denial_reason || null : null,
          review_note: input.review_note || null,
        })
        .eq("id", requestId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: medicationChangeRequestsKey(variables.patientId) });
    },
  });
}
