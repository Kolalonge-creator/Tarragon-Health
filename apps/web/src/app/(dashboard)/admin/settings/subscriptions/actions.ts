"use server";

import { toMinorUnits, type Currency } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { syncPlanToPaystack } from "@/lib/paystack/plans";
import { syncPlanToStripe } from "@/lib/stripe/plans";
import { createPlanSchema } from "@/lib/validation/subscription-plans";
import { createAddOnSchema } from "@/lib/validation/add-ons";
import { priceAdjustmentSchema, type PriceAdjustmentInput } from "@/lib/validation/price-adjustment";
import {
  planPriceAdjustment,
  type AdjustableRow,
  type AdjustmentPlanRow,
} from "@/lib/billing/price-adjustment";

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

/* -------------------------------------------------------------------------
 * Bulk price adjustment — the annual inflation-review tool.
 *
 * The marketing No-Hidden-Cost Promise commits to reviewing Naira prices at
 * most once a year with 30 days' notice, honouring anything already paid.
 * This tool implements the mechanical half of that promise:
 * - rows with a price lock or any active/trialing subscriber are NEVER
 *   adjusted (reported for the existing clone-as-new-plan flow instead);
 * - adjusted rows get their provider references cleared and are re-synced,
 *   because Paystack Plans / Stripe Prices are immutable on amount — a new
 *   provider object at the new price is the only correct move;
 * - every applied change lands in the immutable audit_log.
 * The 30-day patient notice itself is a comms step (broadcast/announcement),
 * deliberately not automated here.
 * ------------------------------------------------------------------------- */

export type BulkAdjustmentTarget = "plan" | "add_on";

export type BulkAdjustmentPreviewRow = AdjustmentPlanRow & {
  target: BulkAdjustmentTarget;
  interval: "monthly" | "yearly";
  wasActive: boolean;
};

export type BulkAdjustmentPreview =
  | { ok: true; rows: BulkAdjustmentPreviewRow[] }
  | { ok: false; error: string };

type BillableTableRow = {
  id: string;
  code: string;
  name: string;
  currency: Currency;
  interval: "monthly" | "yearly";
  price_minor: number;
  price_locked: boolean;
  is_active: boolean;
};

/**
 * Loads plans and/or add-ons in scope, with a live count of active/trialing
 * subscriptions per row — the count matters because the price-lock trigger
 * only fires on the Paystack webhook path, so a Stripe subscriber can exist
 * on an unlocked row and must still be protected.
 */
async function loadAdjustableRows(
  input: PriceAdjustmentInput,
): Promise<{ target: BulkAdjustmentTarget; row: BillableTableRow; activeSubs: number }[]> {
  const svc = createServiceRoleClient();
  const out: { target: BulkAdjustmentTarget; row: BillableTableRow; activeSubs: number }[] = [];

  if (input.includePlans) {
    let query = svc
      .from("subscription_plans")
      .select("id, code, name, currency, interval, price_minor, price_locked, is_active")
      .order("currency")
      .order("price_minor");
    if (input.currency !== "ALL") query = query.eq("currency", input.currency);
    const { data: plans, error } = await query;
    if (error) throw new Error(error.message);

    const { data: subs, error: subsError } = await svc
      .from("subscriptions")
      .select("plan_id")
      .in("status", ["active", "trialing"]);
    if (subsError) throw new Error(subsError.message);
    const subCounts = new Map<string, number>();
    for (const sub of subs ?? []) {
      if (sub.plan_id) subCounts.set(sub.plan_id, (subCounts.get(sub.plan_id) ?? 0) + 1);
    }
    for (const plan of (plans ?? []) as BillableTableRow[]) {
      out.push({ target: "plan", row: plan, activeSubs: subCounts.get(plan.id) ?? 0 });
    }
  }

  if (input.includeAddOns) {
    let query = svc
      .from("add_ons")
      .select("id, code, name, currency, interval, price_minor, price_locked, is_active")
      .order("currency")
      .order("price_minor");
    if (input.currency !== "ALL") query = query.eq("currency", input.currency);
    const { data: addOns, error } = await query;
    if (error) throw new Error(error.message);

    const { data: attached, error: attachedError } = await svc
      .from("subscription_add_ons")
      .select("add_on_id")
      .in("status", ["active", "trialing"]);
    if (attachedError) throw new Error(attachedError.message);
    const attachCounts = new Map<string, number>();
    for (const item of attached ?? []) {
      if (item.add_on_id) {
        attachCounts.set(item.add_on_id, (attachCounts.get(item.add_on_id) ?? 0) + 1);
      }
    }
    for (const addOn of (addOns ?? []) as BillableTableRow[]) {
      out.push({ target: "add_on", row: addOn, activeSubs: attachCounts.get(addOn.id) ?? 0 });
    }
  }

  return out;
}

function toPreviewRows(
  loaded: { target: BulkAdjustmentTarget; row: BillableTableRow; activeSubs: number }[],
  input: PriceAdjustmentInput,
): BulkAdjustmentPreviewRow[] {
  const adjustable: AdjustableRow[] = loaded.map(({ row, activeSubs }) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    currency: row.currency,
    price_minor: row.price_minor,
    price_locked: row.price_locked,
    is_active: row.is_active,
    active_subscriber_count: activeSubs,
  }));
  const planned = planPriceAdjustment(adjustable, {
    percent: input.percent,
    includeInactive: input.includeInactive,
  });
  return planned.map((planRow, index) => ({
    ...planRow,
    target: loaded[index].target,
    interval: loaded[index].row.interval,
    wasActive: loaded[index].row.is_active,
  }));
}

export async function previewPriceAdjustment(raw: unknown): Promise<BulkAdjustmentPreview> {
  await requireAdmin();
  const parsed = priceAdjustmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  try {
    const loaded = await loadAdjustableRows(parsed.data);
    return { ok: true, rows: toPreviewRows(loaded, parsed.data) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to load rows" };
  }
}

export type BulkAdjustmentResult =
  | {
      ok: true;
      adjusted: { code: string; oldMinor: number; newMinor: number; synced: boolean }[];
      locked: string[];
      syncFailures: { code: string; error: string }[];
    }
  | { ok: false; error: string };

export async function applyPriceAdjustment(raw: unknown): Promise<BulkAdjustmentResult> {
  const profile = await requireAdmin();
  const parsed = priceAdjustmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // Recomputed from fresh DB state at apply time — the preview is
  // informational, never a stale source of truth.
  let rows: BulkAdjustmentPreviewRow[];
  try {
    const loaded = await loadAdjustableRows(parsed.data);
    rows = toPreviewRows(loaded, parsed.data);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to load rows" };
  }

  const svc = createServiceRoleClient();
  const adjusted: { code: string; oldMinor: number; newMinor: number; synced: boolean }[] = [];
  const syncFailures: { code: string; error: string }[] = [];
  const locked = rows.filter((row) => row.status === "locked").map((row) => row.code);

  for (const row of rows) {
    if (row.status !== "adjust") continue;
    const table = row.target === "plan" ? "subscription_plans" : "add_ons";

    // Clear provider refs alongside the price: Paystack Plans and Stripe
    // Prices are immutable on amount, so the row must re-sync into a NEW
    // provider object. Deactivate until that sync succeeds (same
    // inactive-until-synced convention as plan creation).
    const { error: updateError } = await svc
      .from(table)
      .update({
        price_minor: row.newMinor,
        paystack_plan_code: null,
        stripe_price_id: null,
        stripe_product_id: null,
        is_active: false,
      })
      .eq("id", row.id)
      .eq("price_locked", false);
    if (updateError) {
      syncFailures.push({ code: row.code, error: updateError.message });
      continue;
    }

    let synced = false;
    // Intentionally-parked (inactive) rows just get the new price; they sync
    // when an admin activates them via the existing "Sync now" flow.
    if (row.wasActive) {
      const sync = await syncPlanRow({
        currency: row.currency,
        paystack_plan_code: null,
        stripe_price_id: null,
        stripe_product_id: null,
        name: row.name,
        price_minor: row.newMinor,
        interval: row.interval,
      });
      if (sync.ok) {
        await svc.from(table).update({ ...sync.data, is_active: true }).eq("id", row.id);
        synced = true;
      } else {
        syncFailures.push({ code: row.code, error: sync.error });
      }
    }

    await svc.from("audit_log").insert({
      actor_id: profile.id,
      organisation_id: profile.organisation_id,
      action: "billing.price_adjustment",
      entity_type: row.target === "plan" ? "subscription_plan" : "add_on",
      entity_id: row.id,
      event: {
        code: row.code,
        percent: parsed.data.percent,
        old_price_minor: row.oldMinor,
        new_price_minor: row.newMinor,
        currency: row.currency,
        resynced: synced,
      },
    });

    adjusted.push({ code: row.code, oldMinor: row.oldMinor, newMinor: row.newMinor, synced });
  }

  return { ok: true, adjusted, locked, syncFailures };
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
