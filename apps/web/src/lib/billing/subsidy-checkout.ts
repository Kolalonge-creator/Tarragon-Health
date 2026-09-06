import { createClient } from "@/lib/supabase/server";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { initializeOneOffTransaction } from "@/lib/paystack/transactions";
import type { CheckoutMetadata } from "@/lib/billing/checkout-metadata";

export type SubsidizedOrderType = "lab" | "pharmacy" | "referral";

export type SubsidyCheckoutResult =
  | {
      ok: true;
      subsidyId: string;
      sponsorAmountKobo: number;
      patientAmountKobo: number;
      /** Present only if the sponsor owes something and Paystack accepted the charge. */
      sponsorCheckoutUrl: string | null;
    }
  | { ok: false; error: string };

/**
 * §91.9 two-simultaneous-charges subsidy mechanic (founder decision). A
 * sponsor with a real `manage` grant over the patient starts a subsidized
 * checkout for one real, already-pending order — never a standing
 * per-member-per-month arrangement (see transaction_subsidies' own CHECK
 * constraints, I8). The split is computed server-side by
 * private.compute_transaction_subsidy via the create_transaction_subsidy
 * RPC, which also re-checks the manage grant (belt-and-braces with the
 * money-lands re-check in private.apply_subsidy_contribution_from_transaction).
 *
 * This only starts the SPONSOR's own charge. The patient's reduced share is
 * a separate charge they make themselves via payMySubsidyShare() — the order
 * only flips to payment_confirmed once both have landed. Every real order
 * here is NGN-denominated (one naira price list), so this is Paystack-only
 * by design, unlike the sponsored-subscription path which also serves
 * diaspora GBP/USD sponsors.
 */
export async function initiateSubsidizedCheckout(args: {
  orderType: SubsidizedOrderType;
  orderId: string;
  email: string;
  callbackUrl: string;
}): Promise<SubsidyCheckoutResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data, error } = await supabase.rpc("create_transaction_subsidy", {
    p_order_type: args.orderType,
    p_order_id: args.orderId,
    p_sponsor_profile_id: user.id,
  });
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not start a subsidized checkout for that order." };
  }

  const result = data as {
    subsidy_id: string;
    sponsor_amount_kobo: number;
    patient_amount_kobo: number;
    sponsor_contribution_id: string | null;
  };

  if (!result.sponsor_contribution_id || result.sponsor_amount_kobo <= 0) {
    return {
      ok: true,
      subsidyId: result.subsidy_id,
      sponsorAmountKobo: result.sponsor_amount_kobo,
      patientAmountKobo: result.patient_amount_kobo,
      sponsorCheckoutUrl: null,
    };
  }

  const checkout = await startContributionCheckout(supabase, {
    contributionId: result.sponsor_contribution_id,
    amountMinor: result.sponsor_amount_kobo,
    email: args.email,
    callbackUrl: args.callbackUrl,
    profileId: user.id,
  });
  if (!checkout.ok) return { ok: false, error: checkout.error };

  return {
    ok: true,
    subsidyId: result.subsidy_id,
    sponsorAmountKobo: result.sponsor_amount_kobo,
    patientAmountKobo: result.patient_amount_kobo,
    sponsorCheckoutUrl: checkout.checkoutUrl,
  };
}

export type PayShareResult = { ok: true; checkoutUrl: string } | { ok: false; error: string };

/**
 * Pays whichever side of a subsidized order belongs to the caller — the
 * sponsor's share (if initiateSubsidizedCheckout's own redirect was
 * abandoned) or the patient's own reduced share. RLS on subsidy_contributions
 * already scopes the row to payer_profile_id = caller, so this can't be used
 * to pay someone else's share.
 */
export async function payMySubsidyShare(args: {
  contributionId: string;
  email: string;
  callbackUrl: string;
}): Promise<PayShareResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: contribution } = await supabase
    .from("subsidy_contributions")
    .select("id, amount_minor, status, payer_profile_id")
    .eq("id", args.contributionId)
    .maybeSingle();

  if (!contribution || contribution.payer_profile_id !== user.id) {
    return { ok: false, error: "That contribution isn't yours to pay." };
  }
  if (contribution.status !== "pending_payment") {
    return { ok: false, error: "That share has already been paid." };
  }

  return startContributionCheckout(supabase, {
    contributionId: contribution.id,
    amountMinor: contribution.amount_minor,
    email: args.email,
    callbackUrl: args.callbackUrl,
    profileId: user.id,
  });
}

async function startContributionCheckout(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: { contributionId: string; amountMinor: number; email: string; callbackUrl: string; profileId: string },
): Promise<PayShareResult> {
  if (!isPaystackConfigured()) return { ok: false, error: "Card payments aren't set up yet" };

  const metadata: CheckoutMetadata = {
    kind: "subsidy_contribution",
    profile_id: args.profileId,
    item_code: args.contributionId,
    subsidy_contribution_id: args.contributionId,
  };

  const result = await initializeOneOffTransaction({
    email: args.email,
    amountMinor: args.amountMinor,
    currency: "NGN",
    callbackUrl: args.callbackUrl,
    metadata,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const { error: refError } = await supabase.rpc("set_subsidy_contribution_pending_ref", {
    p_contribution_id: args.contributionId,
    p_pending_ref: result.data.reference,
  });
  if (refError) return { ok: false, error: refError.message };

  return { ok: true, checkoutUrl: result.data.authorizationUrl };
}
