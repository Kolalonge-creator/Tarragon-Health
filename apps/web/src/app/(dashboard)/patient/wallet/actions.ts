"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { initiateWalletTopup } from "@/lib/billing/wallet-checkout";
import type { Currency } from "@tarragon/shared";

export type WalletTopupState = { error?: string } | undefined;

/**
 * Start a wallet top-up checkout. targetProfileId defaults to the caller
 * (own top-up / savings); a different profile is the sponsorship path —
 * authorization is enforced twice: get_or_create_wallet_for (RPC) and
 * wallet_topups' INSERT RLS, both via private.can_fund_wallet.
 */
export async function topUpWallet(
  _prevState: WalletTopupState,
  formData: FormData
): Promise<WalletTopupState> {
  const amountNaira = Number(formData.get("amountNaira"));
  const currencyRaw = formData.get("currency");
  const targetProfileRaw = formData.get("targetProfileId");

  if (!Number.isFinite(amountNaira) || amountNaira < 500) {
    return { error: "Minimum top-up is ₦500." };
  }
  const currency: Currency =
    currencyRaw === "GBP" ? "GBP" : currencyRaw === "USD" ? "USD" : "NGN";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  if (!user.email) return { error: "Your account needs an email on file to check out." };

  const targetProfileId =
    typeof targetProfileRaw === "string" && targetProfileRaw ? targetProfileRaw : user.id;

  const { data: walletId, error: walletError } = await supabase.rpc(
    "get_or_create_wallet_for",
    { p_profile: targetProfileId }
  );
  if (walletError || !walletId) {
    return { error: "You're not authorised to top up this wallet." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) return { error: "Account is missing an organisation." };

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const result = await initiateWalletTopup({
    supabase,
    walletId: walletId as string,
    organisationId: profile.organisation_id,
    payerProfileId: user.id,
    creditKobo: Math.round(amountNaira * 100),
    currency,
    email: user.email,
    callbackUrl: `${origin}/patient/wallet`,
  });

  if (!result.ok) return { error: result.error };
  redirect(result.checkoutUrl);
}
