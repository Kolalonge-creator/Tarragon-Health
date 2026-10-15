import { useQuery } from "@tanstack/react-query";
import { usePendingRecordRequests, useWithdrawRecordRequest } from "./record-change-requests";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type PatientCondition = Tables<"patient_conditions">;

const conditionsKey = (patientId: string) => ["patient-conditions", patientId] as const;

/**
 * Patient's structured problem list (spec §76.3 / §1.7,
 * 20260827195615_patient_conditions_problem_list.sql) — the first reader of
 * `patient_conditions` anywhere in the app. Read-only for the patient by
 * design: RLS gives the patient SELECT on their own rows only, only org
 * clinical staff may insert/update/delete (a patient must never edit their
 * own diagnosis) — so there is no mutation hook here, unlike allergies.ts.
 * Ordered by most-recently-identified first so an active, newly-noted
 * condition surfaces above an old, resolved one.
 */
export function useConditions(patientId: string) {
  return useQuery({
    queryKey: conditionsKey(patientId),
    queryFn: async (): Promise<PatientCondition[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_conditions")
        .select("*")
        .eq("patient_id", patientId)
        .order("date_identified", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!patientId,
  });
}

/**
 * The patient's own waiting requests to void or correct a condition she entered herself (S05b-f). She cannot edit a condition
 * directly; a request waits for her care team and the condition stays as it is meanwhile. Only she sees her request (a caregiver gets none).
 */
export function usePendingConditionRequests(patientId: string) {
  return usePendingRecordRequests("patient_conditions", patientId);
}

/** Takes a waiting condition request back. The database checks the request is hers and still waiting. */
export function useWithdrawConditionRequest() {
  return useWithdrawRecordRequest("patient_conditions", conditionsKey);
}
