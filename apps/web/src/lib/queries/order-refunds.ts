import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/* ------------------------------------------------------------------ */
/*  Types — manually defined; the refunds/orders tables may not be in */
/*  the generated database.types.ts yet.                              */
/* ------------------------------------------------------------------ */

export type RefundState = "pending" | "approved" | "processing" | "completed" | "rejected" | "failed";

export type AdminOrderRefund = {
  id: string;
  organisation_id: string;
  order_id: string;
  amount_kobo: number;
  reason: string | null;
  state: RefundState;
  provider: string | null;
  provider_reference: string | null;
  provider_response: string | null;
  requested_by: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  is_test: boolean;
  created_at: string;
  updated_at: string;
  order: {
    amount_kobo: number;
    state: string;
    paid_at: string | null;
    catalog_item: { code: string; name_key: string } | null;
    beneficiary: { full_name: string | null; phone: string | null } | null;
  } | null;
  requester: { full_name: string | null } | null;
};

/** What request_order_refund and decide_order_refund return (jsonb): a stable `result` word, and the order `state` when it refuses. */
export type RefundRpcResult = { result?: string; state?: string } | null;

export type MyOrderRefund = {
  id: string;
  organisation_id: string;
  order_id: string;
  amount_kobo: number;
  reason: string | null;
  state: RefundState;
  provider: string | null;
  provider_reference: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  is_test: boolean;
  created_at: string;
  updated_at: string;
  order: {
    amount_kobo: number;
    catalog_item: { code: string; name_key: string } | null;
  } | null;
};

/* ------------------------------------------------------------------ */
/*  Query keys                                                        */
/* ------------------------------------------------------------------ */

const ADMIN_REFUNDS_KEY = ["admin-order-refunds"];
const MY_REFUNDS_KEY = ["my-order-refunds"];

/* ------------------------------------------------------------------ */
/*  Hooks                                                             */
/* ------------------------------------------------------------------ */

/**
 * Pending order refund requests, oldest first (so the longest-waiting
 * request surfaces first) — visible to admin under refunds' own RLS
 * (private.is_admin()). Joins in just enough of the order, its catalog
 * item, the beneficiary patient, and the requester to show a reviewer
 * what they're deciding on without a second round trip.
 */
export function useAdminOrderRefunds() {
  return useQuery({
    queryKey: ADMIN_REFUNDS_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("refunds")
        .select(
          "*, order:orders!refunds_order_id_fkey(amount_kobo, state, paid_at, catalog_item:catalog_items(code, name_key), beneficiary:profiles!orders_beneficiary_patient_id_fkey(full_name, phone)), requester:profiles!refunds_requested_by_fkey(full_name)",
        )
        .eq("state", "pending")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as unknown as AdminOrderRefund[];
    },
  });
}

/**
 * Approve or deny a pending order refund — public.decide_order_refund
 * does the real work (state transition, provider refund queue, GL
 * reversal) atomically; this only invalidates the pending list afterward.
 * Admin-only at the DB layer (raises 42501 for anyone else).
 */
export function useDecideOrderRefund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { refundId: string; approved: boolean; note?: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("decide_order_refund", {
        p_refund: input.refundId,
        p_approved: input.approved,
        p_note: input.note,
      });
      if (error) throw error;
      return data as RefundRpcResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_REFUNDS_KEY });
    },
  });
}

/**
 * The current user's own order refund requests, newest first — scoped
 * by RLS (requested_by = auth.uid()). Joins just enough of the order
 * and catalog item to show what the refund is for.
 */
export function useMyOrderRefunds() {
  return useQuery({
    queryKey: MY_REFUNDS_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("refunds")
        .select(
          "*, order:orders!refunds_order_id_fkey(amount_kobo, catalog_item:catalog_items(code, name_key))",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as MyOrderRefund[];
    },
  });
}

/**
 * Request a refund on a paid order — public.request_order_refund
 * creates the refund row and any side-effects atomically; this
 * invalidates both the patient's refund list and the orders list
 * afterward so the UI reflects the pending request immediately.
 */
export function useRequestOrderRefund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { orderId: string; reason: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("request_order_refund", {
        p_order: input.orderId,
        p_reason: input.reason,
      });
      if (error) throw error;
      return data as RefundRpcResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MY_REFUNDS_KEY });
      queryClient.invalidateQueries({ queryKey: ["commerce", "orders"] });
    },
  });
}
