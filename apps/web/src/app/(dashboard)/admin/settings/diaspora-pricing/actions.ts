"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { syncPlanToStripe } from "@/lib/stripe/plans";
import { syncPlanToPaystack } from "@/lib/paystack/plans";

export type DiasporaPricingState =
  | { error?: string; message?: string }
  | undefined;

const rateSchema = z.object({
  // Naira per unit of foreign currency. The bounds are deliberately wide — a
  // sanity check against a missing or extra zero, not a forecast.
  ngn_per_gbp: z.coerce.number().gt(0).lt(100_000),
  ngn_per_usd: z.coerce.number().gt(0).lt(100_000),
});

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") throw new Error("Admin access required");
  return profile;
}

/**
 * Sets the two reference rates and carries the consequences all the way
 * through to the payment providers.
 *
 * One price list (v3 §15): a GBP or USD row has no price of its own, it is its
 * naira parent converted at these rates. The database enforces that — see
 * private.enforce_derived_price — so this action computes no prices itself. It
 * moves the rate; the rate's own trigger recomputes every derived row, clears
 * the provider reference of anything whose amount moved, and deactivates it.
 *
 * That last part is why this action then has work to do. Paystack Plans and
 * Stripe Prices are amount-immutable: you cannot change what an existing one
 * charges, only create a replacement. So each repriced row needs a fresh Price
 * object minted and written back before it can be sold again.
 *
 * It fails closed. A row is switched back on only once its new provider object
 * exists, so a partial sync leaves the rest switched off rather than
 * advertising one price while charging another. Saving again retries only what
 * is still missing.
 */
export async function saveCurrencyRates(
  _prev: DiasporaPricingState,
  formData: FormData
): Promise<DiasporaPricingState> {
  await requireAdmin();

  const parsed = rateSchema.safeParse({
    ngn_per_gbp: formData.get("ngn_per_gbp"),
    ngn_per_usd: formData.get("ngn_per_usd"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Both rates must be a positive number" };
  }

  const supabase = createServiceRoleClient();

  const { error: rpcError } = await supabase.rpc("set_currency_reference_rates", {
    p_ngn_per_gbp: parsed.data.ngn_per_gbp,
    p_ngn_per_usd: parsed.data.ngn_per_usd,
  });
  if (rpcError) return { error: rpcError.message };

  const synced = await resyncDerivedRows(supabase);

  revalidatePath("/admin/settings/diaspora-pricing");
  revalidatePath("/admin/settings/subscriptions");
  revalidatePath("/pricing");

  if (synced.failed.length > 0) {
    return {
      error:
        `Rates saved and ${synced.ok} price${synced.ok === 1 ? "" : "s"} updated at the provider, but ` +
        `${synced.failed.length} could not be created and stay switched off: ` +
        `${synced.failed.slice(0, 3).join(", ")}${synced.failed.length > 3 ? "…" : ""}. ` +
        `Nothing is being sold at a stale price. Save again to retry just those.`,
    };
  }
  return {
    message:
      synced.ok === 0
        ? "Rates saved. No prices changed."
        : `Rates saved. ${synced.ok} price${synced.ok === 1 ? "" : "s"} rebuilt at Paystack/Stripe and switched back on.`,
  };
}

/** Retries the provider sync without touching the rates. */
export async function resyncNow(): Promise<DiasporaPricingState> {
  await requireAdmin();
  const supabase = createServiceRoleClient();
  const synced = await resyncDerivedRows(supabase);
  revalidatePath("/admin/settings/diaspora-pricing");
  revalidatePath("/pricing");
  if (synced.failed.length > 0) {
    return { error: `${synced.failed.length} still failing: ${synced.failed.slice(0, 3).join(", ")}` };
  }
  return { message: synced.ok === 0 ? "Nothing was waiting to sync." : `${synced.ok} price(s) synced.` };
}

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

/**
 * Mints a provider price for every derived row missing one, switching each
 * back on as its own sync succeeds. Deliberately row-by-row: one failing
 * Stripe call must not strand the other forty-three.
 */
async function resyncDerivedRows(
  supabase: ServiceClient
): Promise<{ ok: number; failed: string[] }> {
  let ok = 0;
  const failed: string[] = [];

  const [{ data: plans }, { data: addOns }] = await Promise.all([
    supabase
      .from("subscription_plans")
      .select("id, code, name, price_minor, currency, interval, paystack_plan_code, stripe_price_id, stripe_product_id")
      .not("derived_from_code", "is", null)
      .is("stripe_price_id", null),
    supabase
      .from("add_ons")
      .select("id, code, name, price_minor, currency, interval, paystack_plan_code, stripe_price_id, stripe_product_id")
      .not("derived_from_code", "is", null)
      .is("stripe_price_id", null),
  ]);

  const batches = [
    { table: "subscription_plans" as const, rows: plans ?? [] },
    { table: "add_ons" as const, rows: addOns ?? [] },
  ];

  for (const { table, rows } of batches) {
    for (const row of rows) {
      // A derived row is always GBP or USD, so Stripe. The Paystack branch
      // exists only so a future naira-derived row cannot silently skip a sync.
      const result =
        row.currency === "NGN"
          ? await syncPlanToPaystack(row).then((r) =>
              r.ok
                ? { ok: true as const, patch: { paystack_plan_code: r.data.planCode } }
                : { ok: false as const }
            )
          : await syncPlanToStripe(row).then((r) =>
              r.ok
                ? {
                    ok: true as const,
                    patch: { stripe_price_id: r.data.priceId, stripe_product_id: r.data.productId },
                  }
                : { ok: false as const }
            );

      if (!result.ok) {
        failed.push(row.code);
        continue;
      }

      const { error } = await supabase
        .from(table)
        .update({ ...result.patch, is_active: true })
        .eq("id", row.id);
      if (error) {
        failed.push(row.code);
        continue;
      }
      ok += 1;
    }
  }

  return { ok, failed };
}
