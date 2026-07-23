"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { initiateWalletTopupCheckout } from "@/lib/billing/wallet-checkout";
import { nairaToKobo } from "@tarragon/shared";
import type { Currency } from "@tarragon/shared";

export type TopUpWalletState = { error?: string } | undefined;

/**
 * Starts a wallet top-up checkout. Funding your own wallet ("save toward
 * your next health check") and funding someone else's (a diaspora sponsor
 * funding a parent's care, or any consented family member) are the same
 * action — authorization is enforced server-side by
 * get_or_create_wallet_for(), not by anything this form controls.
 */
export async function topUpWallet(
  _prevState: TopUpWalletState,
  formData: FormData,
): Promise<TopUpWalletState> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in" };
  if (!profile.email) return { error: "Your account needs an email on file to check out." };

  const beneficiaryProfileId = (formData.get("beneficiaryProfileId") as string) || profile.id;
  const amountNaira = Number(formData.get("amountNaira"));
  const currency = (formData.get("currency") as Currency) || "NGN";

  if (!Number.isFinite(amountNaira) || amountNaira < 100) {
    return { error: "Enter at least ₦100." };
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const result = await initiateWalletTopupCheckout({
    beneficiaryProfileId,
    creditKobo: nairaToKobo(amountNaira),
    payerCurrency: currency,
    email: profile.email,
    callbackUrl: `${origin}/patient/wallet`,
    description:
      beneficiaryProfileId === profile.id ? "Wallet top-up" : "Wallet top-up for a family member",
  });

  if (!result.ok) return { error: result.error };
  redirect(result.checkoutUrl);
}
