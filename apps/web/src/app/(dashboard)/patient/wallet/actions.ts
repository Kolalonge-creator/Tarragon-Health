"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { initiateWalletTopupCheckout } from "@/lib/billing/wallet-checkout";
import { nairaToKobo } from "@tarragon/shared";
import type { Currency } from "@tarragon/shared";

export type TopUpWalletState = { error?: string } | undefined;

/**
 * Starts a wallet top-up checkout. Funding your own wallet ("save toward
 * your next health check") and funding someone else's (any consented family
 * member, whether they're across town or abroad) are the same action —
 * authorization is enforced server-side by get_or_create_wallet_for(), not
 * by anything this form controls or by where the payer happens to live.
 */
export async function topUpWallet(
  _prevState: TopUpWalletState,
  formData: FormData,
): Promise<TopUpWalletState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  if (!user.email) return { error: "Your account needs an email on file to check out." };

  const beneficiaryProfileId = (formData.get("beneficiaryProfileId") as string) || user.id;
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
    email: user.email,
    callbackUrl: `${origin}/patient/wallet`,
    description:
      beneficiaryProfileId === user.id ? "Wallet top-up" : "Wallet top-up for a family member",
  });

  if (!result.ok) return { error: result.error };
  redirect(result.checkoutUrl);
}
