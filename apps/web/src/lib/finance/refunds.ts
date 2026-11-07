import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";

/**
 * Finance v2 Phase C1: the shared refunds workspace (FIN-V2-2) and the second-approver
 * rule (FIN-V2-3). Reads public.finance_refund_queue / finance_refund_settings_get, decides
 * through public.decide_order_refund (which enforces who may decide, the two-approver
 * rule and the audit), and sets the threshold through
 * public.finance_set_refund_second_approval_threshold. Migration 20261107035055.
 */

const minor = z.number().int();

export const REFUND_STATES = ["pending", "approved", "processing", "completed", "rejected", "failed"] as const;
export type RefundState = (typeof REFUND_STATES)[number];

export const queuedRefundSchema = z.object({
  id: z.string(),
  order_id: z.string(),
  amount_minor: minor,
  state: z.enum(REFUND_STATES),
  reason: z.string(),
  requested_at: z.string(),
  requested_by: z.string().nullable(),
  requested_by_staff: z.boolean(),
  requested_by_me: z.boolean().nullable(),
  needs_second_approval: z.boolean(),
  first_approved_by: z.string().nullable(),
  first_approved_by_me: z.boolean().nullable(),
  first_approved_at: z.string().nullable(),
  first_approval_note: z.string().nullable(),
  decided_by: z.string().nullable(),
  decided_at: z.string().nullable(),
  decision_note: z.string().nullable(),
  completed_at: z.string().nullable(),
  attempts: z.number().int(),
  last_error_code: z.string().nullable(),
  provider_status: z.string().nullable(),
  payer: z.string().nullable(),
  beneficiary: z.string().nullable(),
  item: z.string().nullable(),
  paystack_reference: z.string().nullable(),
  order_paid_at: z.string().nullable(),
  order_price_minor: minor,
});
export type QueuedRefund = z.infer<typeof queuedRefundSchema>;

export const refundQueueSchema = z.object({
  caller_id: z.string().nullable(),
  can_decide: z.boolean(),
  second_approval_threshold_minor: minor.nullable(),
  refunds: z.array(queuedRefundSchema),
});
export type RefundQueue = z.infer<typeof refundQueueSchema>;

export const refundSettingsSchema = z.object({
  currency: z.string(),
  second_approval_threshold_minor: minor.nullable(),
  updated_at: z.string().nullable(),
  updated_by: z.string().nullable(),
});
export type RefundSettings = z.infer<typeof refundSettingsSchema>;

const QUEUE_KEY = ["finance", "refund-queue"] as const;
const SETTINGS_KEY = ["finance", "refund-settings"] as const;

export function useRefundQueue() {
  return useQuery({
    queryKey: QUEUE_KEY,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_refund_queue");
      if (error) throw error;
      return refundQueueSchema.parse(data);
    },
  });
}

export function useRefundSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_refund_settings_get");
      if (error) throw error;
      return refundSettingsSchema.parse(data);
    },
  });
}

export const decisionResultSchema = z.object({ result: z.string() }).passthrough();
export type DecisionResult = z.infer<typeof decisionResultSchema>;

export function useDecideRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { refundId: string; approve: boolean; note?: string }) => {
      const { data, error } = await createClient().rpc("decide_order_refund", {
        p_refund: input.refundId,
        p_approved: input.approve,
        p_note: input.note?.trim() || undefined,
      });
      if (error) throw error;
      return decisionResultSchema.parse(data);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: QUEUE_KEY });
      qc.invalidateQueries({ queryKey: ["worklist-counts"] });
      qc.invalidateQueries({ queryKey: ["admin-order-refunds"] });
    },
  });
}

export function useSetRefundThreshold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { thresholdMinor: number | null; reason: string }) => {
      const { data, error } = await createClient().rpc("finance_set_refund_second_approval_threshold", {
        // null clears the threshold (one approval for every refund). The generated type has no null, so it is cast.
        p_threshold_minor: input.thresholdMinor as number,
        p_reason: input.reason,
      });
      if (error) throw error;
      return refundSettingsSchema.parse(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SETTINGS_KEY });
      qc.invalidateQueries({ queryKey: QUEUE_KEY });
    },
  });
}

/** What the decision function answered, in words for the person who clicked. Null when it succeeded. */
export function decisionMessage(r: DecisionResult): { tone: "success" | "info" | "refusal"; text: string } {
  switch (r.result) {
    case "approved":
      return { tone: "success", text: "Approved. The refund is queued for Paystack, what it paid for has ended, and the payer is told." };
    case "rejected":
      return { tone: "success", text: "Rejected. The payer is told the refund was declined." };
    case "awaiting_second_approval":
      return { tone: "info", text: "Your approval is recorded. A second, different person must approve this refund before anything is paid." };
    case "same_approver":
      return { tone: "refusal", text: "You gave the first approval. A different person must give the second." };
    case "own_request":
      return { tone: "refusal", text: "You asked for this refund, so someone else must decide it." };
    case "reason_needed":
      return { tone: "refusal", text: "Give a reason of at least 5 characters to reject a refund." };
    case "already_decided":
      return { tone: "refusal", text: "Someone has already decided this refund. The list has been refreshed." };
    case "not_found":
      return { tone: "refusal", text: "This refund no longer exists. The list has been refreshed." };
    default:
      return { tone: "refusal", text: `The refund was not changed (${r.result}).` };
  }
}

/** Which tab a refund belongs on. */
export type RefundTab = "decide" | "in_progress" | "failed" | "finished";
export function refundTab(r: QueuedRefund): RefundTab {
  if (r.state === "pending") return "decide";
  if (r.state === "approved" || r.state === "processing") return "in_progress";
  if (r.state === "failed") return "failed";
  return "finished";
}

/**
 * What the current user can do with a pending refund, and why not when they cannot.
 * The database decides in the end; this only keeps buttons honest.
 */
export function decisionAvailability(r: QueuedRefund, canDecide: boolean): { approve: boolean; reject: boolean; why: string | null } {
  if (r.state !== "pending") return { approve: false, reject: false, why: null };
  if (!canDecide) return { approve: false, reject: false, why: "You can see refunds but not decide them. Ask a finance administrator for the refund approval permission." };
  if (r.requested_by_me) return { approve: false, reject: false, why: "You asked for this refund, so someone else must decide it." };
  if (r.first_approved_by_me) return { approve: false, reject: true, why: "You gave the first approval. A different person must give the second." };
  return { approve: true, reject: true, why: null };
}
