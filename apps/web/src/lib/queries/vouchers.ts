import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type CareVoucher = Tables<"care_vouchers">;
export type CareVoucherPayment = Tables<"care_voucher_payments">;
export type CareVoucherEvent = Tables<"care_voucher_events">;

/** The order types a voucher can settle. Deliberately excludes video_visit,
 * which is request -> pay -> hold -> a doctor accepts, and must not be
 * short-circuited by prepaid credit. */
export type VoucherPayableOrderType = "lab" | "pharmacy" | "referral";

const ORDER_QUERY_KEY: Record<VoucherPayableOrderType, string> = {
  lab: "lab-orders",
  pharmacy: "pharmacy-orders",
  referral: "specialist-referrals",
};

/** Every voucher this person holds, newest first. RLS decides what comes
 * back: their own, ones they bought for somebody else, and ones belonging to
 * a person who granted them access. */
export function useMyVouchers(profileId: string | null | undefined) {
  return useQuery({
    queryKey: ["care-vouchers", profileId],
    enabled: !!profileId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_vouchers")
        .select("*")
        .eq("beneficiary_profile_id", profileId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CareVoucher[];
    },
  });
}

/** Vouchers this person bought for somebody else — the sponsor's receipts. */
export function useVouchersIBought(profileId: string | null | undefined) {
  return useQuery({
    queryKey: ["care-vouchers", "purchased", profileId],
    enabled: !!profileId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_vouchers")
        .select("*")
        .eq("purchaser_profile_id", profileId as string)
        .neq("beneficiary_profile_id", profileId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CareVoucher[];
    },
  });
}

export function useVoucherPayments(voucherId: string | null | undefined) {
  return useQuery({
    queryKey: ["care-vouchers", "payments", voucherId],
    enabled: !!voucherId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_voucher_payments")
        .select("*")
        .eq("voucher_id", voucherId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CareVoucherPayment[];
    },
  });
}

/** The services that can actually be bought ahead of time. Same
 * self_bookable catalogue the booking card already uses, so a voucher can
 * never be sold for something a patient is not allowed to order directly. */
export function useVoucherCatalogue() {
  return useQuery({
    queryKey: ["care-vouchers", "catalogue"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("panel_bundles")
        .select("id, code, name, description, price_kobo")
        .eq("self_bookable", true)
        .order("price_kobo");
      if (error) throw error;
      return data;
    },
  });
}

export function useVoucherConfig() {
  return useQuery({
    queryKey: ["care-vouchers", "config"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_voucher_config")
        .select("*")
        .eq("id", true)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Redeems a voucher against a pending_payment order. The DB does the real
 * work atomically: it checks the voucher is for THIS service and THIS person,
 * marks it used, and settles the order — so this mutation only has to
 * invalidate the same lists the card-payment flow already refreshes.
 */
export function useRedeemVoucher() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      voucherId: string;
      orderType: VoucherPayableOrderType;
      orderId: string;
      patientId: string;
    }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("redeem_care_voucher", {
        p_voucher: input.voucherId,
        p_order_type: input.orderType,
        p_order_id: input.orderId,
      });
      if (error) throw error;
      return data as { ok: boolean; covered_kobo: number; fully_covered: boolean; remaining_payable_kobo: number };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [ORDER_QUERY_KEY[variables.orderType], variables.patientId] });
      queryClient.invalidateQueries({ queryKey: [ORDER_QUERY_KEY[variables.orderType]] });
      queryClient.invalidateQueries({ queryKey: ["care-vouchers"] });
    },
  });
}

/** Lazily mints (or returns) the caller's own shareable referral code. Safe
 * to call repeatedly — get_or_create_my_referral_code() is idempotent. */
export function useMyReferralCode() {
  return useQuery({
    queryKey: ["care-vouchers", "my-referral-code"],
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

/** True when this voucher can be spent right now. Mirrors the RPC's own
 * conditions so the UI does not offer a button the DB will refuse. */
export function isVoucherSpendable(v: CareVoucher): boolean {
  if (v.status !== "active") return false;
  if (v.expires_at && new Date(v.expires_at) <= new Date()) return false;
  return true;
}

/** Whether a voucher can settle a specific order. A prepaid voucher is for
 * one named service and nothing else; a reward discount applies anywhere. */
export function voucherCoversOrder(
  v: CareVoucher,
  orderType: VoucherPayableOrderType,
  panelBundleId: string | null | undefined,
): boolean {
  if (!isVoucherSpendable(v)) return false;
  if (v.kind === "reward_discount") return true;
  return orderType === "lab" && !!panelBundleId && v.panel_bundle_id === panelBundleId;
}
