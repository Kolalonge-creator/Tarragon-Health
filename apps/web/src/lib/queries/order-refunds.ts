import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { parseRefundPolicy, type RefundPolicy } from "@/lib/commerce/refund-rule";
import { collapseRefundGroups } from "@/lib/commerce/refund-groups";

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
  requested_by: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  is_test: boolean;
  created_at: string;
  updated_at: string;
  /** Set when the refund is one of several (a partly paid order, S25b); the group's first row has its own id here. */
  refund_group?: string | null;
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

export type RefundStep = "requested" | "approved" | "declined" | "sending" | "completed" | "problem" | "retrying";

export type MyOrderRefund = {
  id: string;
  organisation_id: string;
  order_id: string;
  amount_kobo: number;
  reason: string | null;
  state: RefundState;
  provider: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  is_test: boolean;
  created_at: string;
  updated_at: string;
  refund_group?: string | null;
  order: {
    amount_kobo: number;
    catalog_item: { code: string; name_key: string } | null;
  } | null;
  /** The steps so far, oldest first (refund_status_events). */
  steps: { step: RefundStep; created_at: string }[];
};

/** A refund an admin must act on (public.admin_refund_ops). The operational columns are not readable through the table. */
export type OpsRefund = {
  id: string;
  order_id: string;
  amount_kobo: number;
  attempts: number;
  last_error_code?: string | null;
  provider_status?: string | null;
  updated_at?: string;
  processing_started_at?: string;
  patient_name: string | null;
  name_key: string | null;
  code: string | null;
};
export type RefundOps = { failed: OpsRefund[]; stuck: OpsRefund[] };

/* ------------------------------------------------------------------ */
/*  Query keys                                                        */
/* ------------------------------------------------------------------ */

const ADMIN_REFUNDS_KEY = ["admin-order-refunds"];
/** The columns of `refunds` a signed-in person may read (the S26b migration grants exactly these; `select *` is refused on purpose). */
const REFUND_COLUMNS = "id, organisation_id, order_id, amount_kobo, reason, state, provider, requested_by, decided_by, decided_at, decision_note, is_test, created_at, updated_at, completed_at, refund_group";
const MY_REFUNDS_KEY = ["my-order-refunds"];
const FAILED_REFUNDS_KEY = ["admin-failed-order-refunds"];

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
          `${REFUND_COLUMNS}, order:orders!refunds_order_id_fkey(amount_kobo, state, paid_at, catalog_item:catalog_items(code, name_key), beneficiary:profiles!orders_beneficiary_patient_id_fkey(full_name, phone)), requester:profiles!refunds_requested_by_fkey(full_name)`,
        )
        .eq("state", "pending")
        .order("created_at", { ascending: true });
      if (error) throw error;
      // S25b: a refund of a partly paid order is one row per paid part; the admin decides it once, on the group's first row, for the whole amount
      return collapseRefundGroups(data as unknown as AdminOrderRefund[]);
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
          `${REFUND_COLUMNS}, order:orders!refunds_order_id_fkey(amount_kobo, catalog_item:catalog_items(code, name_key)), steps:refund_status_events(step, created_at)`,
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return collapseRefundGroups(data as unknown as MyOrderRefund[]).map((r) => ({
        ...r,
        steps: [...(r.steps ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
      }));
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

/**
 * The numbers the refund rule quotes, from the database's active config (public.entitlement_policy_public). A failed or malformed answer
 * falls back to the shared registry values, so the rule is always shown and never quotes a number typed into a component.
 */
export function useRefundPolicy() {
  return useQuery<RefundPolicy>({
    queryKey: ["refund-policy"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("entitlement_policy_public");
      if (error) return parseRefundPolicy(null);
      return parseRefundPolicy(data);
    },
  });
}

/** Refunds that failed at the provider, and refunds stuck mid-send, for an admin to act on (public.admin_refund_ops). */
export function useAdminRefundOps() {
  return useQuery({
    queryKey: FAILED_REFUNDS_KEY,
    queryFn: async (): Promise<RefundOps> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("admin_refund_ops");
      if (error) throw error;
      const d = (data ?? {}) as Partial<RefundOps>;
      return { failed: Array.isArray(d.failed) ? d.failed : [], stuck: Array.isArray(d.stuck) ? d.stuck : [] };
    },
  });
}

/** An admin finishes a refund stuck in 'processing' after looking at the Paystack dashboard: it was sent (paid) or it was not. */
export function useSettleProcessingRefund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { refundId: string; paid: boolean }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("admin_settle_processing_refund", { p_refund: input.refundId, p_paid: input.paid });
      if (error) throw error;
      return data as RefundRpcResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FAILED_REFUNDS_KEY });
    },
  });
}

export function useRetryFailedRefund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (refundId: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("retry_failed_refund", { p_refund: refundId });
      if (error) throw error;
      return data as RefundRpcResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FAILED_REFUNDS_KEY });
    },
  });
}
