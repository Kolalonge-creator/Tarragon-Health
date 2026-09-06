"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser, createClient } from "@/lib/supabase/server";
import { initiateVoucherPaymentCheckout } from "@/lib/billing/voucher-checkout";
import { nairaToKobo } from "@tarragon/shared";

export type VoucherActionState = { error?: string; message?: string } | undefined;

/**
 * Buys a fixed window of a service for yourself, or for someone who has
 * linked you to their care.
 *
 * The SKU is a service, not a test: most tests are paid straight to the
 * laboratory, so there is normally nothing for Tarragon to sell ahead of
 * time. A service is different, because it is the thing Tarragon actually
 * provides. The one deliberate exception is a self-bookable, Synlab-priced
 * health check panel (screen_core and friends) — Synlab has been a
 * partner-billed lab since 20260821193144_switch_on_synlab.sql, so that
 * bundle is a real, biddable Tarragon product too. It does not go through
 * this function: see buyHealthCheckVoucher below, which calls
 * public.purchase_care_voucher (re-enabled for exactly this case) instead of
 * purchase_service_voucher.
 *
 * The price is never taken from this form. purchase_service_voucher reads it
 * from the catalogue and freezes it on the voucher, so a tampered client
 * cannot change what a service costs. Buying reserves it; payment is a
 * separate step and may be spread over instalments. The recipient then
 * redeems it when they are ready, so nobody is put on a plan without an act
 * of their own.
 */
export async function buyCareVoucher(
  _prevState: VoucherActionState,
  formData: FormData,
): Promise<VoucherActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const beneficiaryProfileId = (formData.get("beneficiaryProfileId") as string) || user.id;
  const serviceProductId = formData.get("serviceProductId") as string;
  const giftMessage = ((formData.get("giftMessage") as string) || "").trim() || undefined;

  if (!serviceProductId) return { error: "Choose which service you'd like to buy." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("purchase_service_voucher", {
    p_beneficiary: beneficiaryProfileId,
    p_service_product_id: serviceProductId,
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
    message: `Reserved ${result.voucher_number ?? "your voucher"}. Pay for it whenever you're ready, in one go or bit by bit, and they can start it whenever suits them.`,
  };
}

/**
 * Buys a named health check — a real, self-bookable, Synlab-priced panel
 * (screen_core and friends) — for yourself or for someone who has linked you
 * to their care, ahead of time. This is the diaspora "Gift a Health Check"
 * flow: a supporter abroad reserves the check now, pays in naira (NGN via
 * Paystack only — see voucher-checkout.ts's 2026-09-03 Stripe removal), in
 * one go or in instalments (payTowardVoucher, unchanged), and their parent
 * redeems it later via RedeemVoucherButton on the annual health check page —
 * no card of the supporter's ever needs to touch the recipient's account.
 *
 * public.purchase_care_voucher pins the price from panel_bundles server-side
 * and refuses anything not self_bookable, so this cannot be used to route
 * around a clinician-ordered test. Original body:
 * supabase/migrations/20260731215226_care_vouchers_purchase_and_layaway.sql;
 * stubbed to always fail by 20260803134416_self_arranged_consistency_sweep.sql
 * while every lab was self-arranged; restored for partner-billed bundles once
 * Synlab went live by 20260830014817_revert_care_voucher_to_panel_bundle_gifting.sql
 * (see docs/DIASPORA_HEALTH_CHECK_BUSINESS_MODEL_RECONCILIATION.md for the
 * full history, including an intermediate guarded version this superseded).
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
 * The recipient starts the window somebody bought them.
 *
 * Deliberately theirs to press: public.redeem_service_voucher refuses anyone
 * but the beneficiary, including the person who paid. If they already have
 * this service active it extends that rather than opening a second grant, so
 * a gift can never double-bill them.
 */
export async function redeemServiceVoucher(
  _prevState: VoucherActionState,
  formData: FormData,
): Promise<VoucherActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const voucherId = formData.get("voucherId") as string;
  if (!voucherId) return { error: "Which voucher?" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("redeem_service_voucher", {
    p_voucher_id: voucherId,
  });
  if (error) return { error: error.message };

  const result = data as { product_name?: string; covered_until?: string };
  const until = result.covered_until
    ? new Date(result.covered_until).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;
  return {
    message: `You're on ${result.product_name ?? "your plan"}${until ? ` until ${until}` : ""}. Nothing renews automatically, so there is no card to cancel.`,
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

  if (!voucherId) return { error: "Which voucher are you paying for?" };
  if (!Number.isFinite(amountNaira) || amountNaira <= 0) {
    return { error: "Enter how much you'd like to pay." };
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const result = await initiateVoucherPaymentCheckout({
    voucherId,
    instalmentKobo: nairaToKobo(amountNaira),
    email: user.email,
    callbackUrl: `${origin}/patient/vouchers`,
    description: "Care voucher payment",
  });

  if (!result.ok) return { error: result.error };
  redirect(result.checkoutUrl);
}
