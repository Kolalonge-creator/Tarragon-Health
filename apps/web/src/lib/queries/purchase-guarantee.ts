import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type GuaranteeClaim = Tables<"service_purchase_guarantee_claims">;

export const MY_GUARANTEE_CLAIMS_QUERY_KEY = ["purchase-guarantee-claims", "mine"];

/**
 * The signed-in patient's own first-purchase money-back guarantee claims —
 * RLS already scopes this to patient_id = auth.uid(). Used to decide, per
 * purchase, whether to show "Request a refund" or the claim's current
 * status instead.
 */
export function useMyGuaranteeClaims() {
  return useQuery({
    queryKey: MY_GUARANTEE_CLAIMS_QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("service_purchase_guarantee_claims")
        .select("*")
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return data as GuaranteeClaim[];
    },
  });
}

export type RequestGuaranteeRefundResult =
  | { ok: true; claim_id: string }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_refundable_status"
        | "not_eligible_provider"
        | "nothing_paid"
        | "window_expired"
        | "not_first_purchase"
        | "already_claimed";
      status?: string;
    };

/**
 * Requests a guarantee refund for one of the patient's own purchases.
 * Eligibility (first-purchase, 30-day window, paid-by-card-or-credit) is
 * entirely server-derived inside request_purchase_guarantee_refund — this
 * never pre-computes or trusts a client-side eligibility guess, it just
 * calls the RPC and reports back whichever reason it returns. Never calls
 * decide_purchase_guarantee_refund — that stays admin-only.
 */
export function useRequestPurchaseGuaranteeRefund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { servicePurchaseId: string; reason?: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("request_purchase_guarantee_refund", {
        p_service_purchase_id: input.servicePurchaseId,
        p_reason: input.reason,
      });
      if (error) throw error;
      return data as RequestGuaranteeRefundResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MY_GUARANTEE_CLAIMS_QUERY_KEY });
    },
  });
}
