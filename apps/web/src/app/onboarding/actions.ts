"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { initializeTransaction } from "@/lib/paystack/transactions";
import { isStripeConfigured } from "@/lib/stripe/client";
import { createCheckoutSession } from "@/lib/stripe/checkout";
import { resolveProvider } from "@/lib/billing/provider";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  demographicsSchema,
  consentSchema,
  identityVerificationSchema,
} from "@/lib/validation/onboarding";
import { verifyIdentity } from "@/lib/identity/provider";

export type SaveDemographicsState = { error?: string; success?: boolean } | undefined;

/**
 * Saves the patient's own date of birth + sex on their profiles row
 * (RLS-scoped — a patient may update their own profile). These are a hard
 * prerequisite for finishing onboarding (see
 * private.enforce_onboarding_prereqs) because the risk/screening engines are
 * age/sex-dependent.
 */
export async function saveDemographics(
  _prevState: SaveDemographicsState,
  formData: FormData,
): Promise<SaveDemographicsState> {
  const parsed = demographicsSchema.safeParse({
    dateOfBirth: formData.get("dateOfBirth"),
    sex: formData.get("sex"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase
    .from("profiles")
    .update({ date_of_birth: parsed.data.dateOfBirth, sex: parsed.data.sex })
    .eq("id", user.id);
  if (error) {
    return { error: error.message };
  }
  return { success: true };
}

export type AcceptConsentsState = { error?: string; success?: boolean } | undefined;

/**
 * Records the caller's acceptance of every current consent version as an
 * append-only patient_consents row. Idempotent-ish: re-accepting inserts new
 * rows (the audit history is intentional), but has_required_consents only
 * checks existence so a double-submit is harmless.
 */
export async function acceptConsents(
  _prevState: AcceptConsentsState,
  formData: FormData,
): Promise<AcceptConsentsState> {
  const parsed = consentSchema.safeParse({ accept: formData.get("accept") === "on" });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please accept to continue" };
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

  const { data: versions, error: versionsError } = await supabase
    .from("consent_versions")
    .select("id, consent_type, version")
    .eq("is_current", true);
  if (versionsError) {
    return { error: versionsError.message };
  }
  if (!versions || versions.length === 0) {
    return { error: "No consents are configured — contact support." };
  }

  const { error } = await supabase.from("patient_consents").insert(
    versions.map((version) => ({
      organisation_id: profile.organisation_id!,
      patient_id: user.id,
      consent_type: version.consent_type,
      consent_version_id: version.id,
      version: version.version,
    })),
  );
  if (error) {
    return { error: error.message };
  }
  return { success: true };
}

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

export type IdentityVerificationState =
  | { error?: string; status?: "verified" | "failed" | "pending" | "unavailable" }
  | undefined;

/**
 * Optional KYC. Records a pending identity_verifications request (storing only
 * the last 4 digits of the ID number — never the full NIN/BVN), then attempts
 * verification through the provider boundary. When no provider is configured
 * the request simply stays pending for ops/webhook resolution. This is never a
 * blocker for onboarding.
 */
export async function submitIdentityVerification(
  _prevState: IdentityVerificationState,
  formData: FormData,
): Promise<IdentityVerificationState> {
  const parsed = identityVerificationSchema.safeParse({
    method: formData.get("method"),
    idNumber: formData.get("idNumber"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
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

  const idLast4 = parsed.data.idNumber.slice(-4);

  const { data: request, error: insertError } = await supabase
    .from("identity_verifications")
    .insert({
      organisation_id: profile.organisation_id,
      patient_id: user.id,
      method: parsed.data.method,
      status: "pending",
      id_last4: idLast4,
    })
    .select("id")
    .single();
  if (insertError || !request) {
    return { error: insertError?.message ?? "Could not record your request" };
  }

  const result = await verifyIdentity(parsed.data.method, parsed.data.idNumber);

  if (result.ok) {
    // Verified/failed results are written via the service-role client so the
    // status can never be self-asserted by a patient session.
    const service = createServiceRoleClient();
    if (result.verified) {
      const verifiedAt = new Date().toISOString();
      await service
        .from("identity_verifications")
        .update({
          status: "verified",
          provider: result.provider,
          reference: result.reference,
          verified_at: verifiedAt,
        })
        .eq("id", request.id);
      await service
        .from("profiles")
        .update({ identity_verified_at: verifiedAt })
        .eq("id", user.id);
      return { status: "verified" };
    }
    // Provider reached, but the number didn't check out — a definitive fail.
    await service
      .from("identity_verifications")
      .update({ status: "failed", provider: result.provider })
      .eq("id", request.id);
    return { status: "failed" };
  }

  // Provider unavailable (unconfigured) or unreachable (transient error):
  // leave the request pending for a retry / ops resolution.
  return { status: result.reason === "unavailable" ? "unavailable" : "pending" };
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
    .select("id, code, price_minor, currency, interval, paystack_plan_code, stripe_price_id")
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

  if (!user.email) {
    return { error: "Your account needs an email on file to check out." };
  }
  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const callbackUrl = `${origin}/onboarding/checkout-callback`;

  if (resolveProvider(plan.currency) === "paystack") {
    if (!isPaystackConfigured()) {
      return {
        error: "Card payments aren't set up yet — try again shortly, or start on Tarragon Free for now.",
      };
    }
    if (!plan.paystack_plan_code) {
      return { error: "This plan isn't ready for checkout yet — contact support." };
    }

    const result = await initializeTransaction({
      email: user.email,
      amountMinor: plan.price_minor,
      currency: plan.currency,
      paystackPlanCode: plan.paystack_plan_code,
      callbackUrl,
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

  if (!isStripeConfigured()) {
    return {
      error: "Card payments aren't set up yet — try again shortly, or start on Tarragon Free for now.",
    };
  }
  if (!plan.stripe_price_id) {
    return { error: "This plan isn't ready for checkout yet — contact support." };
  }

  const result = await createCheckoutSession({
    email: user.email,
    stripePriceId: plan.stripe_price_id,
    successUrl: callbackUrl,
    cancelUrl: `${origin}/onboarding`,
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
    provider: "stripe",
    pending_provider_ref: result.data.sessionId,
  });
  if (insertError) {
    return { error: insertError.message };
  }

  redirect(result.data.checkoutUrl);
}
