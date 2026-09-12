import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Tables } from "@tarragon/shared";

/**
 * Native equivalent of care-vouchers-card.tsx, scoped to what carries no
 * payment: viewing owned vouchers, redeeming an already-paid-for one
 * (redeem_service_voucher RPC), and the referral code. Buying a voucher and
 * paying an instalment toward one are both Paystack checkouts
 * (buyCareVoucher/buyHealthCheckVoucher/payTowardVoucher in
 * apps/web/.../patient/vouchers/actions.ts) -- those stay a system-browser
 * hand-off, same App Store 3.1.1 reasoning as every other one-off checkout
 * on this platform (see care-support-screen.tsx's own header comment).
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

export async function redeemServiceVoucher(
  voucherId: string
): Promise<{ error?: string; message?: string }> {
  const { data, error } = await supabase.rpc("redeem_service_voucher", { p_voucher_id: voucherId });
  if (error) return { error: error.message };
  const result = data as { product_name?: string; covered_until?: string };
  const until = result.covered_until
    ? new Date(result.covered_until).toLocaleDateString("en-GB", {
        timeZone: "Africa/Lagos",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;
  return {
    message: `You're on ${result.product_name ?? "your plan"}${until ? ` until ${until}` : ""}. Nothing renews automatically, so there is no card to cancel.`,
  };
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
