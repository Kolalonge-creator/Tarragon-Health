import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type HealthWallet = Tables<"health_wallets">;
export type WalletLedgerEntry = Tables<"wallet_ledger">;
export type WalletSavingsGoal = Tables<"wallet_savings_goals">;

/** The caller's own wallet — lazily created server-side by the RPC. */
export function useMyWallet() {
  return useQuery({
    queryKey: ["wallet", "me"],
    queryFn: async (): Promise<HealthWallet | null> => {
      const supabase = createClient();
      const { data: walletId, error: rpcError } = await supabase.rpc("get_or_create_my_wallet");
      if (rpcError) throw rpcError;
      const { data, error } = await supabase
        .from("health_wallets")
        .select("*")
        .eq("id", walletId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/** A wallet by owner profile id — works for the owner and consented grantees
 * (profile_access) via RLS; returns null when not visible. */
export function useWalletOf(profileId: string | null) {
  return useQuery({
    queryKey: ["wallet", "of", profileId],
    queryFn: async (): Promise<HealthWallet | null> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("health_wallets")
        .select("*")
        .eq("profile_id", profileId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!profileId,
  });
}

export function useWalletLedger(walletId: string | null) {
  return useQuery({
    queryKey: ["wallet-ledger", walletId],
    queryFn: async (): Promise<WalletLedgerEntry[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("wallet_ledger")
        .select("*")
        .eq("wallet_id", walletId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!walletId,
  });
}

export function useActiveSavingsGoal(walletId: string | null) {
  return useQuery({
    queryKey: ["wallet-goal", walletId],
    queryFn: async (): Promise<WalletSavingsGoal | null> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("wallet_savings_goals")
        .select("*")
        .eq("wallet_id", walletId!)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!walletId,
  });
}

export function useCreateSavingsGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (goal: {
      organisationId: string;
      walletId: string;
      name: string;
      panelBundleId: string | null;
      targetKobo: number;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("wallet_savings_goals").insert({
        organisation_id: goal.organisationId,
        wallet_id: goal.walletId,
        name: goal.name,
        panel_bundle_id: goal.panelBundleId,
        target_kobo: goal.targetKobo,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      queryClient.invalidateQueries({ queryKey: ["wallet-goal", v.walletId] });
    },
  });
}

export function useCancelSavingsGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ goalId }: { goalId: string; walletId: string }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("wallet_savings_goals")
        .update({ status: "cancelled" })
        .eq("id", goalId);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      queryClient.invalidateQueries({ queryKey: ["wallet-goal", v.walletId] });
    },
  });
}

export function useMyReferralCode() {
  return useQuery({
    queryKey: ["referral-code", "me"],
    queryFn: async (): Promise<string> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_or_create_my_referral_code");
      if (error) throw error;
      return data as string;
    },
  });
}

export function useRedeemReferralCode() {
  return useMutation({
    mutationFn: async (code: string): Promise<{ ok: boolean; error?: string }> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("redeem_referral_code", { p_code: code });
      if (error) throw error;
      return data as { ok: boolean; error?: string };
    },
  });
}

/** Pay a pending_payment order from the caller's wallet — atomic RPC. */
export function useWalletPayOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderType,
      orderId,
    }: {
      orderType: "lab" | "pharmacy" | "referral";
      orderId: string;
    }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("wallet_pay_booking_order", {
        p_order_type: orderType,
        p_order_id: orderId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallet", "me"] });
      queryClient.invalidateQueries({ queryKey: ["wallet-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["lab-orders"] });
      queryClient.invalidateQueries({ queryKey: ["pharmacy-orders"] });
      queryClient.invalidateQueries({ queryKey: ["screening-schedules"] });
    },
  });
}
