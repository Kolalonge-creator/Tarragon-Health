"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser, createClient } from "@/lib/supabase/server";
import { initiateVoucherPaymentCheckout } from "@/lib/billing/voucher-checkout";
import { nairaToKobo } from "@tarragon/shared";
import type { Currency } from "@tarragon/shared";

export type VoucherActionState = { error?: string; message?: string } | undefined;

/**
 * Buys a Care Voucher for a named service, for yourself or for someone who
 * has linked you to their care. The price is never taken from this form:
 * purchase_care_voucher reads it from the catalogue and freezes it on the
 * voucher, so a tampered client cannot change what a service costs.
 *
 * Buying does not charge anything. It reserves the voucher; payment is a
 * separate step and may be spread over several instalments.
 */
export async function buyCareVoucher(
  _prevState: VoucherActionState,
  formData: FormData,
): Promise<VoucherActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const beneficiaryProfileId = (formData.get("beneficiaryProfileId") as string) || user.id;
  const panelBundleId = formData.get("panelBundleId") as string;
  const giftMessage = ((formData.get("giftMessage") as string) || "").trim() || undefined;

  if (!panelBundleId) return { error: "Choose which check you'd like to buy." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("purchase_care_voucher", {
    p_beneficiary: beneficiaryProfileId,
    p_panel_bundle_id: panelBundleId,
    p_gift_message: giftMessage,
  });

  if (error) {
    return {
      error:
        error.code === "42501"
          ? "You can only buy care for yourself or someone who has linked you to their care."
          : error.message,
    };
  }

  const result = data as { voucher_number?: string; sku_name?: string };
  return {
    message: `Reserved ${result.sku_name ?? "your voucher"} (${result.voucher_number ?? ""}). Pay for it whenever you're ready, in one go or bit by bit.`,
  };
}

/**
 * Pays some or all of what is outstanding on one specific voucher. This is
 * layaway against a named product, not a deposit into a balance: the money
 * is attached to this voucher id and the voucher only becomes usable once it
 * is fully paid.
 */
export async function payTowardVoucher(
  _prevState: VoucherActionState,
  formData: FormData,
): Promise<VoucherActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  if (!user.email) return { error: "Your account needs an email on file to check out." };

  const voucherId = formData.get("voucherId") as string;
  const amountNaira = Number(formData.get("amountNaira"));
  const currency = (formData.get("currency") as Currency) || "NGN";

  if (!voucherId) return { error: "Which voucher are you paying for?" };
  if (!Number.isFinite(amountNaira) || amountNaira <= 0) {
    return { error: "Enter how much you'd like to pay." };
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const result = await initiateVoucherPaymentCheckout({
    voucherId,
    creditKobo: nairaToKobo(amountNaira),
    payerCurrency: currency,
    email: user.email,
    callbackUrl: `${origin}/patient/vouchers`,
    description: "Care voucher payment",
  });

  if (!result.ok) return { error: result.error };
  redirect(result.checkoutUrl);
}
