"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser, createClient } from "@/lib/supabase/server";
import { initiateVoucherPaymentCheckout } from "@/lib/billing/voucher-checkout";
import { nairaToKobo } from "@tarragon/shared";
import type { Currency } from "@tarragon/shared";

export type VoucherActionState = { error?: string; message?: string } | undefined;

/**
 * Buys a year of a plan for yourself, or for someone who has linked you to
 * their care.
 *
 * The SKU is a subscription. Corrected 2026-08-29: the sibling comment this
 * one used to carry ("tests are paid straight to the laboratory, so there is
 * nothing to sell ahead of time — purchase_care_voucher fails closed") was
 * true only while every lab was self-arranged. Synlab has been a
 * partner-billed lab since 20260821193144_switch_on_synlab.sql, so a
 * self-bookable Synlab-priced bundle (screen_core and friends) is a real,
 * biddable Tarragon product now — see buyHealthCheckVoucher below, which
 * finally wires up purchase_care_voucher for exactly that case.
 *
 * The price is never taken from this form. purchase_subscription_voucher reads
 * it from the catalogue and freezes it on the voucher, so a tampered client
 * cannot change what a plan costs. Buying reserves it; payment is a separate
 * step and may be spread over instalments. The recipient then redeems it when
 * they are ready, so nobody is put on a plan without an act of their own.
 */
export async function buyCareVoucher(
  _prevState: VoucherActionState,
  formData: FormData,
): Promise<VoucherActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const beneficiaryProfileId = (formData.get("beneficiaryProfileId") as string) || user.id;
  const planId = formData.get("planId") as string;
  const giftMessage = ((formData.get("giftMessage") as string) || "").trim() || undefined;

  if (!planId) return { error: "Choose which plan you'd like to buy." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("purchase_subscription_voucher", {
    p_beneficiary: beneficiaryProfileId,
    p_plan_id: planId,
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

  const result = data as { voucher_number?: string };
  return {
    message: `Reserved ${result.voucher_number ?? "your voucher"}. Pay for it whenever you're ready, in one go or bit by bit, and they can start their year whenever suits them.`,
  };
}

/**
 * Buys a named health check — a real, self-bookable, Synlab-priced panel
 * (screen_core and friends) — for yourself or for someone who has linked you
 * to their care, ahead of time. This is the diaspora "Gift a Health Check"
 * flow: a supporter abroad reserves the check now, pays in GBP/USD or NGN, in
 * one go or in instalments (payTowardVoucher, unchanged), and their parent
 * redeems it later via RedeemVoucherButton on the annual health check page —
 * no card of the supporter's ever needs to touch the recipient's account.
 *
 * public.purchase_care_voucher pins the price from panel_bundles server-side
 * and refuses anything not self_bookable, so this cannot be used to route
 * around a clinician-ordered test. See the migration this finally connects:
 * supabase/migrations/20260731215226_care_vouchers_purchase_and_layaway.sql.
 */
export async function buyHealthCheckVoucher(
  _prevState: VoucherActionState,
  formData: FormData,
): Promise<VoucherActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const beneficiaryProfileId = (formData.get("beneficiaryProfileId") as string) || user.id;
  const panelBundleId = formData.get("panelBundleId") as string;
  const giftMessage = ((formData.get("giftMessage") as string) || "").trim() || undefined;

  if (!panelBundleId) return { error: "Choose which health check you'd like to buy." };

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
          ? "You can only buy a health check for yourself or someone who has linked you to their care."
          : error.message,
    };
  }

  const result = data as { voucher_number?: string; sku_name?: string };
  return {
    message: `Reserved ${result.sku_name ?? "a health check"} (${result.voucher_number ?? "voucher"}). Pay for it whenever you're ready, in one go or bit by bit, and they can book it whenever suits them.`,
  };
}

/**
 * The recipient starts the year somebody bought them.
 *
 * Deliberately theirs to press: public.redeem_subscription_voucher refuses
 * anyone but the beneficiary, including the person who paid. If they already
 * have a plan running it extends that rather than opening a second one, so a
 * gift can never double-bill them.
 */
export async function redeemSubscriptionVoucher(
  _prevState: VoucherActionState,
  formData: FormData,
): Promise<VoucherActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const voucherId = formData.get("voucherId") as string;
  if (!voucherId) return { error: "Which voucher?" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("redeem_subscription_voucher", {
    p_voucher_id: voucherId,
  });
  if (error) return { error: error.message };

  const result = data as { plan_name?: string; covered_until?: string };
  const until = result.covered_until
    ? new Date(result.covered_until).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;
  return {
    message: `You're on ${result.plan_name ?? "your plan"}${until ? ` until ${until}` : ""}. Nothing renews automatically, so there is no card to cancel.`,
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
