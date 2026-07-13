"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { initializeTransaction } from "@/lib/paystack/transactions";

/**
 * Marks onboarding complete for the signed-in caller only — there is no
 * admin/staff path to set this on someone else's behalf (RLS already
 * restricts profiles updates to the owning user or org staff, but this
 * action never takes a patientId argument, so it can't be pointed at
 * another account even by mistake).
 */
export async function completeOnboarding() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  await supabase
    .from("profiles")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", user.id);

  redirect("/patient");
}

export type StartCheckoutState = { error?: string } | undefined;

/**
 * Free tier (price_minor === 0) activates immediately, no Paystack
 * involved, then finishes onboarding the same way the old "Continue to my
 * dashboard" button did. A paid tier creates a 'trialing' subscriptions row
 * with pending_provider_ref set to the just-initialized Paystack
 * transaction reference, then redirects the browser to Paystack's hosted
 * checkout — activation itself only ever happens later, when
 * paystack-webhook's charge.success handler matches that reference (see
 * its correlation notes). Onboarding is only marked complete for the paid
 * path once the patient lands back on /onboarding/checkout-callback.
 */
export async function startCheckout(
  _prevState: StartCheckoutState,
  formData: FormData,
): Promise<StartCheckoutState> {
  const planCode = formData.get("planCode");
  if (typeof planCode !== "string" || !planCode) {
    return { error: "Choose a plan first" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return { error: "This account has no organisation on file" };
  }

  const { data: plan } = await supabase
    .from("subscription_plans")
    .select("id, code, price_minor, currency, interval, paystack_plan_code")
    .eq("code", planCode)
    .eq("is_active", true)
    .maybeSingle();
  if (!plan) {
    return { error: "That plan is not available right now" };
  }

  if (plan.price_minor === 0) {
    const { error } = await supabase.from("subscriptions").insert({
      organisation_id: profile.organisation_id,
      subscriber_id: user.id,
      plan_id: plan.id,
      status: "active",
      currency: plan.currency,
      amount_minor: 0,
      interval: plan.interval,
    });
    if (error) {
      return { error: error.message };
    }
    await completeOnboarding();
    return;
  }

  if (!isPaystackConfigured()) {
    return {
      error: "Card payments aren't set up yet — try again shortly, or start on Tarragon Free for now.",
    };
  }
  if (!plan.paystack_plan_code) {
    return { error: "This plan isn't ready for checkout yet — contact support." };
  }
  if (!user.email) {
    return { error: "Your account needs an email on file to check out." };
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const result = await initializeTransaction({
    email: user.email,
    amountMinor: plan.price_minor,
    currency: plan.currency,
    paystackPlanCode: plan.paystack_plan_code,
    callbackUrl: `${origin}/onboarding/checkout-callback`,
    metadata: { kind: "subscription", profile_id: user.id, item_code: plan.code },
  });
  if (!result.ok) {
    return { error: result.error };
  }

  const { error: insertError } = await supabase.from("subscriptions").insert({
    organisation_id: profile.organisation_id,
    subscriber_id: user.id,
    plan_id: plan.id,
    status: "trialing",
    currency: plan.currency,
    amount_minor: plan.price_minor,
    interval: plan.interval,
    provider: "paystack",
    pending_provider_ref: result.data.reference,
  });
  if (insertError) {
    return { error: insertError.message };
  }

  redirect(result.data.authorizationUrl);
}
