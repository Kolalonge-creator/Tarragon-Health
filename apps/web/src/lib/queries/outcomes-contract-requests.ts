import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export const PENDING_OUTCOMES_CONTRACT_REQUESTS_QUERY_KEY = ["outcomes-contract-requests", "pending"];

export type OutcomesContractChangeRequest = {
  id: string;
  organisation_id: string;
  contract_type: "fee_at_risk" | "flat";
  proposed_outcome_thresholds: unknown;
  proposed_payout_terms: string | null;
  proposed_effective_from: string;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  organisation: { name: string } | null;
  requested_by_profile: { full_name: string | null } | null;
};

/** Superadmin-only review queue — RLS's own select policy
 * (private.is_org_staff OR private.is_admin) already scopes this correctly,
 * so the admin-only page wrapper is the real gate; this just fetches
 * everything currently pending across every org. */
export function usePendingOutcomesContractRequests() {
  return useQuery({
    queryKey: PENDING_OUTCOMES_CONTRACT_REQUESTS_QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("outcomes_contract_change_requests")
        .select(
          "id, organisation_id, contract_type, proposed_outcome_thresholds, proposed_payout_terms, proposed_effective_from, status, requested_at, organisation:organisations(name), requested_by_profile:profiles!outcomes_contract_change_requests_requested_by_fkey(full_name)"
        )
        .eq("status", "pending")
        .order("requested_at", { ascending: true });
      if (error) throw error;
      return data as unknown as OutcomesContractChangeRequest[];
    },
  });
}

export function useApproveOutcomesContractRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; note?: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("approve_outcomes_contract_request", {
        p_id: input.id,
        p_note: input.note,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PENDING_OUTCOMES_CONTRACT_REQUESTS_QUERY_KEY }),
  });
}

export function useRejectOutcomesContractRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; reason: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("reject_outcomes_contract_request", {
        p_id: input.id,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PENDING_OUTCOMES_CONTRACT_REQUESTS_QUERY_KEY }),
  });
}
