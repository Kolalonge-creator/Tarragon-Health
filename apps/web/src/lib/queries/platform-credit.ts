import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type PlatformCreditBalance = Tables<"platform_credit_balances">;
export type PlatformCreditLedgerEntry = Tables<"platform_credit_ledger_entries">;
export type PlatformCreditConfig = Tables<"platform_credit_config">;

/** The caller's own platform credit balance. Null (not an error) means no
 * row exists yet — a patient who has never topped up — and should read as a
 * zero balance, never as "loading forever" or "something broke". */
export function useMyPlatformCreditBalance(patientId: string | null | undefined) {
  return useQuery({
    queryKey: ["platform-credit", "balance", patientId],
    enabled: !!patientId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("platform_credit_balances")
        .select("*")
        .eq("patient_id", patientId as string)
        .maybeSingle();
      if (error) throw error;
      return data as PlatformCreditBalance | null;
    },
  });
}

export function usePlatformCreditConfig() {
  return useQuery({
    queryKey: ["platform-credit", "config"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("platform_credit_config")
        .select("*")
        .eq("id", true)
        .single();
      if (error) throw error;
      return data as PlatformCreditConfig;
    },
  });
}

/** Most recent activity — top-ups, spends, admin grants/corrections — newest
 * first. Used for the "What happened to my balance" history list. */
export function useMyPlatformCreditLedger(patientId: string | null | undefined, limit = 20) {
  return useQuery({
    queryKey: ["platform-credit", "ledger", patientId, limit],
    enabled: !!patientId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("platform_credit_ledger_entries")
        .select("*")
        .eq("patient_id", patientId as string)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as PlatformCreditLedgerEntry[];
    },
  });
}

export type PayWithCreditResult =
  | { ok: true; service_purchase_id: string; amount_kobo: number; new_balance_kobo: number }
  | { ok: true; already_active: boolean }
  | { ok: false; reason: "not_payable"; status: string }
  | { ok: false; reason: "insufficient_balance"; balance_kobo: number; required_kobo: number; shortfall_kobo: number };

/**
 * Pays for a pending service purchase entirely out of the caller's platform
 * credit balance — no Paystack round trip. Two RPC calls: create the pending
 * row (record_service_purchase_intent, the one legitimate way in — same RPC
 * the card-payment flow uses), then settle it from credit
 * (pay_service_purchase_on_platform_credit). The DB does the real work
 * atomically inside that second call; this only invalidates what changed.
 */
export function usePayServicePurchaseWithCredit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      patientId: string;
      serviceProductCode: string;
      scopedEntityType?: string;
      scopedEntityId?: string;
    }) => {
      const supabase = createClient();
      const { data: purchaseId, error: intentError } = await supabase.rpc(
        "record_service_purchase_intent",
        {
          p_patient_id: input.patientId,
          p_service_product_code: input.serviceProductCode,
          p_scoped_entity_type: input.scopedEntityType,
          p_scoped_entity_id: input.scopedEntityId,
        },
      );
      if (intentError || !purchaseId) {
        throw intentError ?? new Error("Could not start this purchase");
      }

      const { data, error } = await supabase.rpc("pay_service_purchase_on_platform_credit", {
        p_service_purchase_id: purchaseId,
      });
      if (error) throw error;
      return data as PayWithCreditResult;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["platform-credit"] });
      queryClient.invalidateQueries({ queryKey: ["service-purchases", variables.patientId] });
      queryClient.invalidateQueries({ queryKey: ["service-purchases"] });
    },
  });
}

export type PayPharmacyOrderWithCreditResult =
  | { ok: true; pharmacy_order_id: string; amount_kobo: number; new_balance_kobo: number }
  | { ok: true; already_active: boolean }
  | { ok: false; reason: "not_payable"; status: string }
  | { ok: false; reason: "insufficient_balance"; balance_kobo: number; required_kobo: number; shortfall_kobo: number };

/**
 * Pays for a pharmacy order already sitting at status='pending_payment'
 * entirely out of the caller's platform credit balance — no Paystack
 * redirect. Single RPC call (unlike usePayServicePurchaseWithCredit, the
 * pending row already exists by the time this button is shown — see
 * PayForPharmacyOrderButton) — public.pay_pharmacy_order_on_platform_credit
 * does the balance check + spend + order activation atomically.
 */
export function usePayPharmacyOrderWithCredit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { patientId: string; pharmacyOrderId: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("pay_pharmacy_order_on_platform_credit", {
        p_pharmacy_order_id: input.pharmacyOrderId,
      });
      if (error) throw error;
      return data as PayPharmacyOrderWithCreditResult;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["platform-credit"] });
      queryClient.invalidateQueries({ queryKey: ["pharmacy-orders", variables.patientId] });
    },
  });
}

export function useCancelPlatformCreditTopupIntent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (intentId: string) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("cancel_platform_credit_topup_intent", {
        p_intent_id: intentId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-credit"] });
    },
  });
}
