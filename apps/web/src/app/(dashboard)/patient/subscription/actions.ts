"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { initializeTransaction, disableSubscription } from "@/lib/paystack/transactions";
import { isStripeConfigured } from "@/lib/stripe/client";
import { createCheckoutSession, cancelStripeSubscription } from "@/lib/stripe/checkout";
import { resolveProvider } from "@/lib/billing/provider";

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
    .select("id, organisation_id, subscriber_id, provider, provider_ref, provider_email_token, plan_id")
    .eq("id", subscriptionId)
    .eq("subscriber_id", user.id)
    .maybeSingle();
  if (!subscription) {
    throw new Error("Subscription not found");
  }
  return { supabase, user, subscription };
}

/**
 * Whether there's enough on the row to actually call the provider's
 * "stop renewing" API: Stripe only needs provider_ref, Paystack needs both
 * provider_ref and provider_email_token (the latter can lag behind
 * provider_ref if the enrichment webhook hasn't landed yet — see
 * paystack-webhook's correlation notes). Callers use this to decide between
 * the "cancelling, keeps access till period end" message (webhook-driven)
 * and an immediate local-only cancel — a naive `provider_ref &&
 * provider_email_token` check would wrongly fall through to local-only for
 * every Stripe row, since Stripe rows never populate provider_email_token.
 */
function canDisableRemotely(subscription: {
  provider: string | null;
  provider_ref: string | null;
  provider_email_token: string | null;
}): boolean {
  if (!subscription.provider_ref) return false;
  if (subscription.provider === "paystack") return !!subscription.provider_email_token;
  return subscription.provider === "stripe";
}

/**
 * Stops renewal for a base-plan or add-on subscription with an already-live
 * provider subscription, branching on which provider it was ever activated
 * with. Only call this after confirming canDisableRemotely() — Paystack
 * needs both provider_ref (subscription_code) and provider_email_token to
 * call /subscription/disable; Stripe only needs provider_ref (subscription
 * id) plus our own secret key.
 */
async function disableProviderRenewal(subscription: {
  provider: string | null;
  provider_ref: string | null;
  provider_email_token: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!subscription.provider_ref) return { ok: true };

  if (subscription.provider === "paystack") {
    if (!subscription.provider_email_token) return { ok: true };
    const result = await disableSubscription({
      subscriptionCode: subscription.provider_ref,
      emailToken: subscription.provider_email_token,
    });
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }

  if (subscription.provider === "stripe") {
    const result = await cancelStripeSubscription(subscription.provider_ref);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }

  return { ok: true };
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

  const disableResult = await disableProviderRenewal(subscription);
  if (!disableResult.ok) {
    return {
      error: `Couldn't cancel your current plan (${disableResult.error}) — try again before switching.`,
    };
  }
  // subscriptions' UPDATE RLS policy only grants org staff, not the
  // subscriber themselves (unlike subscription_add_ons) — ownership was
  // already verified above via requireOwnedSubscription's RLS-scoped SELECT,
  // so this trusted write uses the service-role client rather than silently
  // no-op'ing under the patient's own session (see createServiceRoleClient's
  // docstring for this pattern).
  await createServiceRoleClient()
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
    .select("id, code, price_minor, currency, interval, paystack_plan_code, stripe_price_id")
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

  if (!user.email) {
    return { error: "Your account needs an email on file to check out." };
  }
  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const callbackUrl = `${origin}/patient/subscription/checkout-callback`;

  if (resolveProvider(plan.currency) === "paystack") {
    if (!isPaystackConfigured() || !plan.paystack_plan_code) {
      return { error: "Card payments aren't set up yet — try again shortly." };
    }
    const result = await initializeTransaction({
      email: user.email,
      amountMinor: plan.price_minor,
      currency: plan.currency,
      paystackPlanCode: plan.paystack_plan_code,
      callbackUrl,
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

  if (!isStripeConfigured() || !plan.stripe_price_id) {
    return { error: "Card payments aren't set up yet — try again shortly." };
  }
  const result = await createCheckoutSession({
    email: user.email,
    stripePriceId: plan.stripe_price_id,
    successUrl: callbackUrl,
    cancelUrl: `${origin}/patient/subscription`,
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
    provider: "stripe",
    pending_provider_ref: result.data.sessionId,
  });
  if (insertError) return { error: insertError.message };

  redirect(result.data.checkoutUrl);
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
    .select("id, code, price_minor, currency, interval, paystack_plan_code, stripe_price_id")
    .eq("code", addOnCode)
    .eq("is_active", true)
    .maybeSingle();
  if (!addOn) {
    return { error: "That add-on is not available right now" };
  }
  if (!user.email) {
    return { error: "Your account needs an email on file to check out." };
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const callbackUrl = `${origin}/patient/subscription/checkout-callback`;
  const metadata = {
    kind: "add_on" as const,
    profile_id: user.id,
    item_code: addOn.code,
    subscription_id: subscription.id,
  };

  if (resolveProvider(addOn.currency) === "paystack") {
    if (!isPaystackConfigured() || !addOn.paystack_plan_code) {
      return { error: "Card payments aren't set up yet — try again shortly." };
    }
    const result = await initializeTransaction({
      email: user.email,
      amountMinor: addOn.price_minor,
      currency: addOn.currency,
      paystackPlanCode: addOn.paystack_plan_code,
      callbackUrl,
      metadata,
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

  if (!isStripeConfigured() || !addOn.stripe_price_id) {
    return { error: "Card payments aren't set up yet — try again shortly." };
  }
  const result = await createCheckoutSession({
    email: user.email,
    stripePriceId: addOn.stripe_price_id,
    successUrl: callbackUrl,
    cancelUrl: `${origin}/patient/subscription`,
    metadata,
  });
  if (!result.ok) return { error: result.error };

  const { error: insertError } = await supabase.from("subscription_add_ons").insert({
    organisation_id: subscription.organisation_id,
    subscription_id: subscription.id,
    add_on_id: addOn.id,
    status: "trialing",
    amount_minor: addOn.price_minor,
    currency: addOn.currency,
    interval: addOn.interval,
    provider: "stripe",
    pending_provider_ref: result.data.sessionId,
  });
  if (insertError) return { error: insertError.message };

  redirect(result.data.checkoutUrl);
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
      "id, provider, provider_ref, provider_email_token, subscription:subscriptions!subscription_add_ons_subscription_id_fkey(subscriber_id)",
    )
    .eq("id", subscriptionAddOnId)
    .maybeSingle();
  if (!row || row.subscription?.subscriber_id !== user.id) {
    return { error: "Add-on not found" };
  }

  if (canDisableRemotely(row)) {
    const disableResult = await disableProviderRenewal(row);
    if (!disableResult.ok) {
      return { error: `Couldn't cancel this add-on (${disableResult.error}) — try again.` };
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
  const { subscription } = await requireOwnedSubscription(subscriptionId);

  if (canDisableRemotely(subscription)) {
    const disableResult = await disableProviderRenewal(subscription);
    if (!disableResult.ok) {
      return { error: `Couldn't cancel (${disableResult.error}) — try again.` };
    }
    return {
      message:
        "Renewal cancelled — you'll keep access until the end of the period you've already paid for, which isn't refundable, then your plan won't renew.",
    };
  }

  // See the matching comment in changePlan above — subscriptions' UPDATE
  // RLS policy doesn't grant the subscriber, only org staff.
  await createServiceRoleClient()
    .from("subscriptions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", subscription.id);
  return { message: "Plan cancelled." };
}
