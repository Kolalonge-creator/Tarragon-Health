import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type GuaranteeClaim = Tables<"service_purchase_guarantee_claims">;

export type AdminGuaranteeClaim = GuaranteeClaim & {
  patient: { full_name: string | null; phone: string | null } | null;
  service_purchase: {
    payable_kobo: number | null;
    amount_kobo: number;
    currency: Tables<"service_purchases">["currency"];
    payment_provider: Tables<"service_purchases">["payment_provider"];
    service_product: { name: string } | null;
  } | null;
};

const QUERY_KEY = ["admin-guarantee-claims"];

/**
 * Pending first-purchase money-back guarantee claims, oldest first (so the
 * longest-waiting patient surfaces first) — visible to admin under
 * service_purchase_guarantee_claims' own RLS (private.is_admin()). Joins in
 * just enough of the patient and the underlying purchase to show a reviewer
 * what they're deciding on without a second round trip.
 */
export function useAdminGuaranteeClaims() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("service_purchase_guarantee_claims")
        .select(
          "*, patient:profiles!service_purchase_guarantee_claims_patient_id_fkey(full_name, phone), service_purchase:service_purchases(payable_kobo, amount_kobo, currency, payment_provider, service_product:service_products(name))",
        )
        .eq("status", "pending")
        .order("requested_at", { ascending: true });
      if (error) throw error;
      return data as AdminGuaranteeClaim[];
    },
  });
}

export type DecideGuaranteeRefundResult =
  | { ok: true; status: "approved"; refund_mode: "queued" | "platform_credit_restored"; amount_kobo: number }
  | { ok: true; status: "denied" }
  | { ok: false; reason: "already_decided" | "purchase_no_longer_refundable"; status?: string };

/**
 * Approve or deny a pending guarantee claim — public.decide_purchase_guarantee_refund
 * does the real work (GL reversal, refund-queue insert or platform-credit
 * restoration) atomically; this only invalidates the pending list afterward.
 * Admin-only at the DB layer (raises 42501 for anyone else) — this page
 * never exposes the control to a non-admin, so that error path is never
 * expected to trigger here.
 */
export function useDecidePurchaseGuaranteeRefund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { claimId: string; approve: boolean; note?: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("decide_purchase_guarantee_refund", {
        p_claim_id: input.claimId,
        p_approve: input.approve,
        p_note: input.note,
      });
      if (error) throw error;
      return data as DecideGuaranteeRefundResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
