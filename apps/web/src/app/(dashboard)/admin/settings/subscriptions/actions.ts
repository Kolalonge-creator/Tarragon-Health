"use server";

import { toMinorUnits, type Currency } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { syncPlanToPaystack } from "@/lib/paystack/plans";
import { syncPlanToStripe } from "@/lib/stripe/plans";
import { createPlanSchema } from "@/lib/validation/subscription-plans";
import { createAddOnSchema } from "@/lib/validation/add-ons";

type SyncResult =
  | { ok: true; data: { paystack_plan_code?: string; stripe_price_id?: string; stripe_product_id?: string } }
  | { ok: false; error: string };

/** NGN rows sync to Paystack; GBP/USD rows sync to Stripe — same branch used
 * at create-time and by the "Sync now" retry hooks. Normalizes both
 * providers' differently-shaped results into one write-back patch. */
async function syncPlanRow(row: {
  currency: Currency;
  paystack_plan_code: string | null;
  stripe_price_id: string | null;
  stripe_product_id?: string | null;
  name: string;
  price_minor: number;
  interval: "monthly" | "yearly";
}): Promise<SyncResult> {
  if (row.currency === "NGN") {
    const result = await syncPlanToPaystack(row);
    if (!result.ok) return result;
    return { ok: true, data: { paystack_plan_code: result.data.planCode } };
  }
  const result = await syncPlanToStripe(row);
  if (!result.ok) return result;
  return { ok: true, data: { stripe_price_id: result.data.priceId, stripe_product_id: result.data.productId } };
}

export type AdminActionState = { error?: string; message?: string } | undefined;

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    throw new Error("Admin access required");
  }
  return profile;
}

function parseFeatures(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
}

/**
 * New plans start `is_active: false` and only flip true once a Paystack
 * Plan object is confirmed synced — a Paystack API failure must never leave
 * a plan patients can select in onboarding but can't actually check out
 * with. Free plans (price 0) never touch Paystack, so they activate
 * immediately.
 */
export async function createPlan(
  _prevState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireAdmin();

  const parsed = createPlanSchema.safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    price_amount: formData.get("price_amount"),
    currency: formData.get("currency") || undefined,
    interval: formData.get("interval"),
    features: formData.get("features") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const priceMinor = toMinorUnits(parsed.data.price_amount, parsed.data.currency);

  const { data: inserted, error: insertError } = await supabase
    .from("subscription_plans")
    .insert({
      code: parsed.data.code,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      price_minor: priceMinor,
      currency: parsed.data.currency,
      interval: parsed.data.interval,
      features: parseFeatures(parsed.data.features),
      is_active: priceMinor === 0,
    })
    .select("id, name, price_minor, currency, interval, paystack_plan_code, stripe_price_id, stripe_product_id")
    .single();
  if (insertError) {
    return { error: insertError.message };
  }
  if (priceMinor === 0) {
    return { message: `${inserted.name} created and active.` };
  }

  const sync = await syncPlanRow(inserted);
  if (!sync.ok) {
    const providerLabel = parsed.data.currency === "NGN" ? "Paystack" : "Stripe";
    return {
      error: `Plan saved but ${providerLabel} sync failed (${sync.error}) — it stays inactive until synced. Try "Sync to ${providerLabel}" below.`,
    };
  }

  await supabase.from("subscription_plans").update({ ...sync.data, is_active: true }).eq("id", inserted.id);

  return { message: `${inserted.name} created and active.` };
}

/** Retry hook for a plan stuck inactive after a failed create-time sync. */
export async function syncPlanNow(planId: string): Promise<AdminActionState> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: plan } = await supabase
    .from("subscription_plans")
    .select("id, name, paystack_plan_code, stripe_price_id, stripe_product_id, price_minor, currency, interval")
    .eq("id", planId)
    .maybeSingle();
  if (!plan) return { error: "Plan not found" };

  const sync = await syncPlanRow(plan);
  if (!sync.ok) return { error: sync.error };

  await supabase.from("subscription_plans").update({ ...sync.data, is_active: true }).eq("id", plan.id);
  return { message: `${plan.name} synced and active.` };
}

export async function createAddOn(
  _prevState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireAdmin();

  const parsed = createAddOnSchema.safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    price_amount: formData.get("price_amount"),
    currency: formData.get("currency") || undefined,
    interval: formData.get("interval"),
    restricted_to_plan_code: formData.get("restricted_to_plan_code") || undefined,
    features: formData.get("features") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const priceMinor = toMinorUnits(parsed.data.price_amount, parsed.data.currency);

  const { data: inserted, error: insertError } = await supabase
    .from("add_ons")
    .insert({
      code: parsed.data.code,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      price_minor: priceMinor,
      currency: parsed.data.currency,
      interval: parsed.data.interval,
      restricted_to_plan_code: parsed.data.restricted_to_plan_code || null,
      features: parseFeatures(parsed.data.features),
      is_active: false,
    })
    .select("id, name, price_minor, currency, interval, paystack_plan_code, stripe_price_id, stripe_product_id")
    .single();
  if (insertError) {
    return { error: insertError.message };
  }

  const sync = await syncPlanRow(inserted);
  if (!sync.ok) {
    const providerLabel = parsed.data.currency === "NGN" ? "Paystack" : "Stripe";
    return {
      error: `Add-on saved but ${providerLabel} sync failed (${sync.error}) — it stays inactive until synced. Try "Sync to ${providerLabel}" below.`,
    };
  }

  await supabase.from("add_ons").update({ ...sync.data, is_active: true }).eq("id", inserted.id);

  return { message: `${inserted.name} created and active.` };
}

export async function syncAddOnNow(addOnId: string): Promise<AdminActionState> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: addOn } = await supabase
    .from("add_ons")
    .select("id, name, paystack_plan_code, stripe_price_id, stripe_product_id, price_minor, currency, interval")
    .eq("id", addOnId)
    .maybeSingle();
  if (!addOn) return { error: "Add-on not found" };

  const sync = await syncPlanRow(addOn);
  if (!sync.ok) return { error: sync.error };

  await supabase.from("add_ons").update({ ...sync.data, is_active: true }).eq("id", addOn.id);
  return { message: `${addOn.name} synced and active.` };
}
