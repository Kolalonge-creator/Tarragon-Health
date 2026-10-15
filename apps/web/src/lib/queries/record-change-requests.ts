import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import type { Enums } from "@tarragon/shared";

/**
 * A patient's own waiting requests to void or correct an entry she typed herself (S05b-d allergies, S05b-f conditions). One table
 * holds both (`record_table` says which), one function withdraws either. The two query modules (allergies.ts, conditions.ts) wrap these
 * hooks so each list invalidates its own data.
 */
export type RecordRequestTable = "patient_allergies" | "patient_conditions";

export interface PendingRecordRequest {
  id: string;
  /** Set for an allergy request, null for a condition request. */
  allergy_id: string | null;
  /** Set for a condition request, null for an allergy request. */
  condition_id: string | null;
  requested_status: Enums<"correction_status">;
  created_at: string;
}

export const requestsKey = (table: RecordRequestTable, patientId: string) => ["patient-record-requests", table, patientId] as const;

/**
 * Only the safe columns are named: the request table is column-granted, and `select *` is refused by design (the clinician's note
 * and identity never reach a client). RLS shows the patient her own rows only, so a caregiver looking at her list sees an empty array.
 */
export function usePendingRecordRequests(table: RecordRequestTable, patientId: string) {
  return useQuery({
    queryKey: requestsKey(table, patientId),
    queryFn: async (): Promise<PendingRecordRequest[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_allergy_correction_requests")
        .select("id, allergy_id, condition_id, requested_status, created_at")
        .eq("patient_id", patientId)
        .eq("record_table", table)
        .eq("status", "pending");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!patientId,
  });
}

const withdrawInputSchema = z.object({
  patientId: z.string().uuid(),
  requestId: z.string().uuid(),
});

export type WithdrawRecordRequestInput = z.input<typeof withdrawInputSchema>;

/** Takes a waiting request back. The database checks the request is hers and still waiting. */
export function useWithdrawRecordRequest(table: RecordRequestTable, dataKey: (patientId: string) => readonly unknown[]) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rawInput: WithdrawRecordRequestInput): Promise<void> => {
      const input = withdrawInputSchema.parse(rawInput);
      const supabase = createClient();
      const { error } = await supabase.rpc("withdraw_patient_allergy_correction", {
        p_request_id: input.requestId,
      });
      if (error) throw error;
    },
    // On success AND on failure: a refusal such as "already decided" means the list on screen is stale, so refresh it either way.
    onSettled: (_result, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: requestsKey(table, variables.patientId) });
      queryClient.invalidateQueries({ queryKey: dataKey(variables.patientId) });
    },
  });
}
