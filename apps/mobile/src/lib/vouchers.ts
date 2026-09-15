import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Tables } from "@tarragon/shared";

/**
 * Native equivalent of care-vouchers-card.tsx, scoped to what carries no
 * payment: viewing owned vouchers and the referral code. Buying a voucher
 * and paying an instalment toward one are both Paystack checkouts
 * (buyHealthCheckVoucher/payTowardVoucher in
 * apps/web/.../patient/vouchers/actions.ts) -- those stay a system-browser
 * hand-off, same App Store 3.1.1 reasoning as every other one-off checkout
 * on this platform (see care-support-screen.tsx's own header comment). The
 * generic redeemable-service-voucher purchase/redeem path
 * (redeem_service_voucher) was removed 2026-09-15 -- zero live rows ever
 * used it; a health-check or reward voucher is still redeemed elsewhere,
 * against the order it's applied to.
 */
export type CareVoucher = Tables<"care_vouchers">;

export function isVoucherSpendable(v: CareVoucher): boolean {
  if (v.status !== "active") return false;
  if (v.expires_at && new Date(v.expires_at) <= new Date()) return false;
  return true;
}

export async function loadMyVouchers(profileId: string): Promise<QueryResult<CareVoucher[]>> {
  const { data, error } = await supabase
    .from("care_vouchers")
    .select("*")
    .eq("beneficiary_profile_id", profileId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data };
}

export async function loadMyReferralCode(): Promise<QueryResult<string>> {
  const { data, error } = await supabase.rpc("get_or_create_my_referral_code");
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as string };
}

export async function redeemReferralCode(code: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("redeem_referral_code", { p_code: code });
  if (error) return { ok: false, error: error.message };
  return data as { ok: boolean; error?: string };
}
