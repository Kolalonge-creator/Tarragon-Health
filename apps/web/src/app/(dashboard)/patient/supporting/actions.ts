"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { initiateSponsoredSubscriptionCheckout } from "@/lib/billing/sponsored-subscription-checkout";
import { initiateSponsorBillCheckout } from "@/lib/billing/sponsor-bill-checkout";
import { parsePaymentMethod } from "@/lib/paystack/channels";
import { startActingFor, stopActingFor } from "@/lib/acting/acting-for";
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
    paymentMethod: parsePaymentMethod(formData.get("paymentMethod")),
  });

  if (!result.ok) return { error: result.error };
  redirect(result.checkoutUrl);
}

/**
 * Settles one of their bills on your own card.
 *
 * Distinct from redeeming a Care Voucher, which only works when the person
 * already holds a paid voucher for that exact named service. Most real bills
 * are not like that: a refill, a video visit, a lab test a clinician ordered.
 * Those had no payment path from this side at all.
 */
export async function paySomeonesBill(
  _prevState: SponsorActionState,
  formData: FormData,
): Promise<SponsorActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  if (!user.email) return { error: "Your account needs an email on file to check out." };

  const beneficiaryProfileId = formData.get("beneficiaryProfileId") as string;
  const orderId = formData.get("orderId") as string;
  const currency = (formData.get("currency") as Currency) || "NGN";

  if (!beneficiaryProfileId || !orderId) return { error: "Which bill are you paying?" };

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  // The amount is deliberately not read from this form. It is looked up
  // server-side against the order itself — see initiateSponsorBillCheckout.
  const result = await initiateSponsorBillCheckout({
    beneficiaryProfileId,
    orderId,
    payerCurrency: currency,
    email: user.email,
    callbackUrl: `${origin}/patient/supporting`,
    paymentMethod: parsePaymentMethod(formData.get("paymentMethod")),
  });

  if (!result.ok) return { error: result.error };
  redirect(result.checkoutUrl);
}

/**
 * A supporter deciding to join as a patient too, on any plan including Free.
 *
 * They keep supporting whoever they support: the two are independent, so this
 * adds care rather than swapping one for the other.
 *
 * Clearing onboarding_completed_at in the same statement is what makes it safe
 * rather than a loophole. enforce_receives_care_switch only permits the flip
 * while onboarding is incomplete, so they are sent back through the *whole*
 * patient flow — consents, date of birth, sex, and the intake questions — and
 * enforce_onboarding_prereqs then demands all of it before they can finish.
 *
 * The intake questions are not paperwork: the screening calendar and the risk
 * scoring are computed from them, so a half-answered patient silently gets a
 * thinner schedule rather than an obviously empty one. That is why joining is
 * the full flow and not a checkbox.
 */
export async function joinAsPatientToo(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  await supabase
    .from("profiles")
    .update({ receives_care: true, onboarding_completed_at: null })
    .eq("id", user.id);

  redirect("/onboarding");
}

/**
 * Opens the account of somebody you support.
 *
 * The grant is re-checked here and again on every request that reads the
 * resulting cookie, so this cannot outlive permission: the moment they revoke
 * it, the next page load is their own account again.
 */
export async function openTheirAccount(
  _prevState: SponsorActionState,
  formData: FormData,
): Promise<SponsorActionState> {
  const beneficiaryProfileId = formData.get("beneficiaryProfileId") as string;
  if (!beneficiaryProfileId) return { error: "Whose account?" };

  const ok = await startActingFor(beneficiaryProfileId);
  if (!ok) return { error: "You don't have permission to open this person's account." };

  redirect("/patient");
}

/** Back to your own account. */
export async function closeTheirAccount(): Promise<void> {
  await stopActingFor();
  redirect("/patient/supporting");
}
