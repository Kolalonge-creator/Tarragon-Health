import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import type { ReviewMedicationRepeatRequestInput } from "@/lib/validation/medications";

export type MedicationRepeatRequest = Tables<"medication_repeat_requests">;

/**
 * §62.11/§62.12 — "I need my next supply" + its clinical review. See
 * 20260829011000_medication_repeat_requests.sql for why there is no
 * auto-approve path: every request reaches a clinician, only the eligibility
 * pre-check (no repeats left, expired, already superseded, one already
 * pending) happens before that, enforced server-side by a BEFORE INSERT
 * trigger — this file never duplicates that logic, it only surfaces the
 * error message the DB raises.
 */

function medicationRepeatRequestsKey(patientId: string) {
  return ["medication-repeat-requests", patientId];
}

/** All of a patient's own repeat requests, newest first — enough to show
 * "next supply requested, awaiting review" against the medication it's for. */
export function useMedicationRepeatRequests(patientId: string) {
  return useQuery({
    queryKey: medicationRepeatRequestsKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medication_repeat_requests")
        .select("*")
        .eq("patient_id", patientId)
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return data as MedicationRepeatRequest[];
    },
    enabled: !!patientId,
  });
}

/** Patient requests the next supply of a repeat prescription. */
export function useRequestMedicationRepeat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ medicationId, patientId }: { medicationId: string; patientId: string }) => {
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
      // medication row regardless of what's sent here (see the trigger's
      // header comment) — supplied only to satisfy the NOT NULL columns.
      const { error } = await supabase.from("medication_repeat_requests").insert({
        medication_id: medicationId,
        patient_id: patientId,
        organisation_id: profile.organisation_id,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: medicationRepeatRequestsKey(variables.patientId) });
    },
  });
}

/**
 * Pending repeat requests for a patient, with enough of the medication
 * attached to review the request without a second lookup — the clinician
 * review panel for spec §62.12, scoped per-patient (same shape as
 * MedicationSafetyPanel) rather than a cross-patient queue.
 */
export function usePendingMedicationRepeatRequests(patientId: string) {
  return useQuery({
    queryKey: [...medicationRepeatRequestsKey(patientId), "pending"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medication_repeat_requests")
        .select("*, medication:medications(drug_name, dose, frequency, rx_number, repeats_allowed)")
        .eq("patient_id", patientId)
        .eq("status", "pending")
        .order("requested_at", { ascending: true });
      if (error) throw error;
      return data as (MedicationRepeatRequest & {
        medication: {
          drug_name: string;
          dose: string | null;
          frequency: string | null;
          rx_number: string | null;
          repeats_allowed: number;
        } | null;
      })[];
    },
    enabled: !!patientId,
  });
}

/**
 * Approve/deny a repeat request. RLS + the review trigger
 * (private.stamp_medication_repeat_request_review) are the real authority
 * gate — private.can_confirm_medication_refill (any active clinical tier,
 * never a Care Coordinator) — and stamp reviewed_by/reviewed_at server-side;
 * this hook never sends either.
 */
export function useReviewMedicationRepeatRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      requestId,
      input,
    }: {
      requestId: string;
      patientId: string;
      input: ReviewMedicationRepeatRequestInput;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("medication_repeat_requests")
        .update({
          status: input.status,
          denial_reason: input.status === "denied" ? input.denial_reason || null : null,
          review_note: input.review_note || null,
        })
        .eq("id", requestId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: medicationRepeatRequestsKey(variables.patientId) });
    },
  });
}
