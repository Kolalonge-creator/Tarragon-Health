import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type WalletLedgerEntry = Tables<"wallet_ledger">;
export type WalletSavingsGoal = Tables<"wallet_savings_goals">;

/** Balance for a given profile's wallet. Returns 0/null when the wallet
 * hasn't been lazily created yet (e.g. a patient who has never earned a
 * reward or topped up) — there is nothing to create just to display ₦0. */
export function useWalletBalance(profileId: string | null | undefined) {
  return useQuery({
    queryKey: ["wallet", "balance", profileId],
    enabled: !!profileId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("health_wallets")
        .select("id, balance_kobo")
        .eq("profile_id", profileId as string)
        .maybeSingle();
      if (error) throw error;
      return data ?? { id: null, balance_kobo: 0 };
    },
  });
}

export function useWalletLedger(walletId: string | null | undefined) {
  return useQuery({
    queryKey: ["wallet", "ledger", walletId],
    enabled: !!walletId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("wallet_ledger")
        .select("*")
        .eq("wallet_id", walletId as string)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as WalletLedgerEntry[];
    },
  });
}

export function useWalletSavingsGoal(walletId: string | null | undefined) {
  return useQuery({
    queryKey: ["wallet", "savings-goal", walletId],
    enabled: !!walletId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("wallet_savings_goals")
        .select("*")
        .eq("wallet_id", walletId as string)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw error;
      return data as WalletSavingsGoal | null;
    },
  });
}

export function useCreateSavingsGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { walletId: string; name: string; targetKobo: number; panelBundleId?: string | null }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { data: wallet } = await supabase
        .from("health_wallets")
        .select("organisation_id")
        .eq("id", input.walletId)
        .single();
      if (!wallet) throw new Error("Wallet not found");
      const { error } = await supabase.from("wallet_savings_goals").insert({
        organisation_id: wallet.organisation_id,
        wallet_id: input.walletId,
        name: input.name,
        target_kobo: input.targetKobo,
        panel_bundle_id: input.panelBundleId ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["wallet", "savings-goal", variables.walletId] });
    },
  });
}

/** Lazily mints (or returns) the caller's own shareable referral code. Safe
 * to call repeatedly — get_or_create_my_referral_code() is idempotent. */
export function useMyReferralCode() {
  return useQuery({
    queryKey: ["wallet", "my-referral-code"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_or_create_my_referral_code");
      if (error) throw error;
      return data as string;
    },
  });
}

export function useRedeemReferralCode() {
  return useMutation({
    mutationFn: async (code: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("redeem_referral_code", { p_code: code });
      if (error) throw error;
      return data as { ok: boolean; error?: string };
    },
  });
}

/** Order types wallet_pay_booking_order actually accepts — a subset of
 * BookingOrderType (video_visit is request→pay→hold→accept, never
 * wallet-payable). */
export type WalletPayableOrderType = "lab" | "pharmacy" | "referral";

const ORDER_TABLE: Record<WalletPayableOrderType, "lab-orders" | "pharmacy-orders" | "specialist-referrals"> = {
  lab: "lab-orders",
  pharmacy: "pharmacy-orders",
  referral: "specialist-referrals",
};

/** Pays a pending_payment booking order straight from the caller's own
 * wallet balance via the atomic wallet_pay_booking_order RPC — debit + order
 * status flip happen in one transaction on the DB side, so this mutation
 * just needs to invalidate the same lists the card-payment flow already
 * relies on for the order to visibly move to "payment_confirmed". */
export function usePayBookingOrderWithWallet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { orderType: WalletPayableOrderType; orderId: string; patientId: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("wallet_pay_booking_order", {
        p_order_type: input.orderType,
        p_order_id: input.orderId,
      });
      if (error) throw error;
      return data as { ok: boolean; balance_kobo: number };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [ORDER_TABLE[variables.orderType], variables.patientId] });
      queryClient.invalidateQueries({ queryKey: [ORDER_TABLE[variables.orderType]] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
    },
  });
}
