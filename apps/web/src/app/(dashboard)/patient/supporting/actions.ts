"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { initiateSponsoredSubscriptionCheckout } from "@/lib/billing/sponsored-subscription-checkout";
import type { Currency } from "@tarragon/shared";

export type SponsorActionState = { error?: string; message?: string } | undefined;

/**
 * Puts someone you support on a paid plan, billed to you.
 *
 * The authorisation that matters is not here — it is re-checked inside
 * private.activate_sponsored_subscription at the moment the money lands, so a
 * grant revoked mid-checkout buys nothing. This layer exists to fail fast and
 * kindly rather than after a card has been charged.
 */
export async function paySomeonesPlan(
  _prevState: SponsorActionState,
  formData: FormData,
): Promise<SponsorActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  if (!user.email) return { error: "Your account needs an email on file to check out." };

  const beneficiaryProfileId = formData.get("beneficiaryProfileId") as string;
  const planCode = formData.get("planCode") as string;
  const currency = (formData.get("currency") as Currency) || "NGN";

  if (!beneficiaryProfileId) return { error: "Who is this plan for?" };
  if (!planCode) return { error: "Choose a plan first." };

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const result = await initiateSponsoredSubscriptionCheckout({
    beneficiaryProfileId,
    planCode,
    payerCurrency: currency,
    email: user.email,
    callbackUrl: `${origin}/patient/supporting`,
  });

  if (!result.ok) return { error: result.error };
  redirect(result.checkoutUrl);
}

/**
 * A supporter deciding they want care here themselves.
 *
 * Clearing onboarding_completed_at in the same statement is what makes this
 * safe rather than a loophole: enforce_care_purpose_switch only permits the
 * flip while onboarding is incomplete, so they are sent back through the full
 * patient flow and enforce_onboarding_prereqs then demands date of birth, sex
 * and the care consents exactly as it would for any new patient. Nothing is
 * skipped — it is collected at the point it becomes true.
 */
export async function setUpMyOwnCare(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  await supabase
    .from("profiles")
    .update({ account_purpose: "care", onboarding_completed_at: null })
    .eq("id", user.id);

  redirect("/onboarding");
}
