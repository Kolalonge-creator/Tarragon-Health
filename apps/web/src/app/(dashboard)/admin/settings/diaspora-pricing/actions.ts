"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type DiasporaPricingState =
  | { error?: string; message?: string }
  | undefined;

const saveSchema = z.object({
  usd_per_gbp: z.coerce.number().gt(0).lt(100),
  // JSON array of { code, price_minor } for USD plans the admin is repricing.
  rows: z
    .string()
    .transform((s) => JSON.parse(s) as unknown)
    .pipe(
      z.array(
        z.object({
          code: z.string().min(1),
          price_minor: z.coerce.number().int().nonnegative(),
        })
      )
    ),
});

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") throw new Error("Admin access required");
  return profile;
}

/**
 * Saves the GBP→USD reference rate and applies the admin's USD diaspora
 * prices. Repricing a plan unlocks it and clears its Stripe ids, because the
 * DB price is our source of truth but the Stripe Price object is not changed
 * here — an admin must re-run "Sync to Stripe" on the subscriptions page for
 * the new amount to actually be charged. No live-feed auto-pricing: the rate
 * is only ever applied when the admin clicks save.
 */
export async function saveDiasporaPricing(
  _prev: DiasporaPricingState,
  formData: FormData
): Promise<DiasporaPricingState> {
  const profile = await requireAdmin();

  const parsed = saveSchema.safeParse({
    usd_per_gbp: formData.get("usd_per_gbp"),
    rows: formData.get("rows"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = createServiceRoleClient();

  const { error: rateError } = await supabase
    .from("platform_currency_settings")
    .update({
      usd_per_gbp: parsed.data.usd_per_gbp,
      updated_at: new Date().toISOString(),
      updated_by: profile.id,
    })
    .eq("id", true);
  if (rateError) return { error: rateError.message };

  let repriced = 0;
  for (const row of parsed.data.rows) {
    const { data: plan } = await supabase
      .from("subscription_plans")
      .select("id, price_minor")
      .eq("code", row.code)
      .eq("currency", "USD")
      .maybeSingle();
    if (!plan || plan.price_minor === row.price_minor) continue;

    // Unlock first (a locked plan rejects a price change), then reprice and
    // clear the stale Stripe ids so no wrong amount can be charged pre-resync.
    await supabase
      .from("subscription_plans")
      .update({ price_locked: false })
      .eq("id", plan.id);
    const { error } = await supabase
      .from("subscription_plans")
      .update({
        price_minor: row.price_minor,
        stripe_price_id: null,
        stripe_product_id: null,
      })
      .eq("id", plan.id);
    if (error) return { error: error.message };
    repriced += 1;
  }

  revalidatePath("/admin/settings/diaspora-pricing");
  revalidatePath("/admin/settings/subscriptions");
  return {
    message:
      repriced > 0
        ? `Saved. ${repriced} USD plan${repriced === 1 ? "" : "s"} repriced — re-run "Sync to Stripe" on the Subscriptions page so the new amounts are charged.`
        : "Rate saved. No USD prices changed.",
  };
}
