"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { initializeTransaction, disableSubscription } from "@/lib/paystack/transactions";

export type SubscriptionActionState = { error?: string; message?: string } | undefined;

/** Every server action here re-checks the caller owns the row being acted
 * on (subscriber_id/subscription_id -> subscriber_id = auth.uid()) as
 * defense-in-depth on top of RLS, before ever calling out to Paystack —
 * money-moving calls don't get to lean on RLS alone. */
async function requireOwnedSubscription(subscriptionId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("id, organisation_id, subscriber_id, provider_ref, provider_email_token, plan_id")
    .eq("id", subscriptionId)
    .eq("subscriber_id", user.id)
    .maybeSingle();
  if (!subscription) {
    throw new Error("Subscription not found");
  }
  return { supabase, user, subscription };
}

/**
 * Paystack has no in-place plan change — this cancels the current
 * subscription (if it has an enriched provider_ref/email_token; otherwise
 * just marks it cancelled locally, since there's nothing to call Paystack
 * with) and starts a fresh checkout for the new plan, same as onboarding's
 * startCheckout. No proration this pass — the new plan starts a fresh
 * billing cycle, a known simplification.
 */
export async function changePlan(
  _prevState: SubscriptionActionState,
  formData: FormData,
): Promise<SubscriptionActionState> {
  const currentSubscriptionId = formData.get("subscriptionId");
  const newPlanCode = formData.get("planCode");
  if (typeof currentSubscriptionId !== "string" || typeof newPlanCode !== "string" || !newPlanCode) {
    return { error: "Choose a plan first" };
  }

  const { supabase, user, subscription } = await requireOwnedSubscription(currentSubscriptionId);

  if (subscription.provider_ref && subscription.provider_email_token) {
    const disableResult = await disableSubscription({
      subscriptionCode: subscription.provider_ref,
      emailToken: subscription.provider_email_token,
    });
    if (!disableResult.ok) {
      return {
        error: `Couldn't cancel your current plan with Paystack (${disableResult.error}) — try again before switching.`,
      };
    }
  }
  await supabase
    .from("subscriptions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", subscription.id);

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
    .eq("code", newPlanCode)
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
    if (error) return { error: error.message };
    return { message: "Switched to Tarragon Free." };
  }

  if (!isPaystackConfigured() || !plan.paystack_plan_code) {
    return { error: "Card payments aren't set up yet — try again shortly." };
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
    callbackUrl: `${origin}/patient/subscription/checkout-callback`,
    metadata: { kind: "subscription", profile_id: user.id, item_code: plan.code },
  });
  if (!result.ok) return { error: result.error };

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
  if (insertError) return { error: insertError.message };

  redirect(result.data.authorizationUrl);
}

export async function attachAddOn(
  _prevState: SubscriptionActionState,
  formData: FormData,
): Promise<SubscriptionActionState> {
  const subscriptionId = formData.get("subscriptionId");
  const addOnCode = formData.get("addOnCode");
  if (typeof subscriptionId !== "string" || typeof addOnCode !== "string" || !addOnCode) {
    return { error: "Choose an add-on first" };
  }

  const { supabase, user, subscription } = await requireOwnedSubscription(subscriptionId);

  const { data: addOn } = await supabase
    .from("add_ons")
    .select("id, code, price_minor, currency, interval, paystack_plan_code")
    .eq("code", addOnCode)
    .eq("is_active", true)
    .maybeSingle();
  if (!addOn) {
    return { error: "That add-on is not available right now" };
  }
  if (!isPaystackConfigured() || !addOn.paystack_plan_code) {
    return { error: "Card payments aren't set up yet — try again shortly." };
  }
  if (!user.email) {
    return { error: "Your account needs an email on file to check out." };
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const result = await initializeTransaction({
    email: user.email,
    amountMinor: addOn.price_minor,
    currency: addOn.currency,
    paystackPlanCode: addOn.paystack_plan_code,
    callbackUrl: `${origin}/patient/subscription/checkout-callback`,
    metadata: {
      kind: "add_on",
      profile_id: user.id,
      item_code: addOn.code,
      subscription_id: subscription.id,
    },
  });
  if (!result.ok) return { error: result.error };

  // The DB-level subscription_add_ons_validate trigger (plan-restriction
  // guard) fires here and rejects this insert outright if the add-on
  // doesn't match the subscription's current plan — surfaced as-is.
  const { error: insertError } = await supabase.from("subscription_add_ons").insert({
    organisation_id: subscription.organisation_id,
    subscription_id: subscription.id,
    add_on_id: addOn.id,
    status: "trialing",
    amount_minor: addOn.price_minor,
    currency: addOn.currency,
    interval: addOn.interval,
    provider: "paystack",
    pending_provider_ref: result.data.reference,
  });
  if (insertError) return { error: insertError.message };

  redirect(result.data.authorizationUrl);
}

export async function detachAddOn(subscriptionAddOnId: string): Promise<SubscriptionActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: row } = await supabase
    .from("subscription_add_ons")
    .select(
      "id, provider_ref, provider_email_token, subscription:subscriptions!subscription_add_ons_subscription_id_fkey(subscriber_id)",
    )
    .eq("id", subscriptionAddOnId)
    .maybeSingle();
  if (!row || row.subscription?.subscriber_id !== user.id) {
    return { error: "Add-on not found" };
  }

  if (row.provider_ref && row.provider_email_token) {
    const disableResult = await disableSubscription({
      subscriptionCode: row.provider_ref,
      emailToken: row.provider_email_token,
    });
    if (!disableResult.ok) {
      return { error: `Couldn't cancel this add-on with Paystack (${disableResult.error}) — try again.` };
    }
    return { message: "Cancelling — this stays active until the end of the current period." };
  }

  await supabase
    .from("subscription_add_ons")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", row.id);
  return { message: "Add-on removed." };
}

export async function cancelSubscription(subscriptionId: string): Promise<SubscriptionActionState> {
  const { supabase, subscription } = await requireOwnedSubscription(subscriptionId);

  if (subscription.provider_ref && subscription.provider_email_token) {
    const disableResult = await disableSubscription({
      subscriptionCode: subscription.provider_ref,
      emailToken: subscription.provider_email_token,
    });
    if (!disableResult.ok) {
      return { error: `Couldn't cancel with Paystack (${disableResult.error}) — try again.` };
    }
    return { message: "Cancelling — you'll keep access until the end of your current billing period." };
  }

  await supabase
    .from("subscriptions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", subscription.id);
  return { message: "Plan cancelled." };
}
