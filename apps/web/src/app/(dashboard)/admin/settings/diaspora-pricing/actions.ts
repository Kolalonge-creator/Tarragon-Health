"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { syncPlanToStripe } from "@/lib/stripe/plans";
import { syncPlanToPaystack } from "@/lib/paystack/plans";

export type DiasporaPricingState =
  | { error?: string; message?: string }
  | undefined;

const rateSchema = z.object({
  // Naira per dollar. The bounds are deliberately wide — a sanity check
  // against a missing or extra zero, not a forecast.
  ngn_per_usd: z.coerce.number().gt(0).lt(100_000),
  // Percentage (10 means 10%), converted to the 0-1 fraction the database
  // stores just before the RPC call below.
  usd_processing_fee_pct: z.coerce.number().gte(0).lt(100),
});

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") throw new Error("Admin access required");
  return profile;
}

/**
 * Sets the reference rate and carries the consequences all the way through to
 * the payment providers.
 *
 * One price list (v3 §15): a dollar row has no price of its own, it is its
 * naira parent converted at this rate. The database enforces that — see
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
    ngn_per_usd: formData.get("ngn_per_usd"),
    usd_processing_fee_pct: formData.get("usd_processing_fee_pct"),
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        "The rate and processing fee must both be positive numbers",
    };
  }

  /**
   * The rate move goes through the caller's OWN session, not the service role.
   *
   * set_usd_reference_rate gates on private.is_admin(), which resolves
   * auth.uid() against profiles. A service-role client carries no uid at all,
   * so is_admin() was returning false and this RPC raised
   * "only a superadmin may change the reference rate" on every single attempt.
   * The form had therefore never once saved: platform_currency_settings still
   * showed updated_by = null and an updated_at matching the migration that
   * seeded the rate (20260729143814), not a human.
   *
   * requireAdmin() above is still the app-layer gate; this just stops us
   * throwing away the identity the database gate needs. The service-role client
   * is still the right tool further down, where resyncDerivedRows writes
   * is_active and provider ids that no ordinary session may touch.
   */
  const asCaller = await createClient();
  const supabase = createServiceRoleClient();

  const { error: rpcError } = await asCaller.rpc("set_usd_reference_rate", {
    p_ngn_per_usd: parsed.data.ngn_per_usd,
  });
  if (rpcError) return { error: rpcError.message };

  // Same gate, same reason: set_usd_processing_fee also resolves auth.uid()
  // against profiles, so it goes through the caller's own session too. Both
  // RPCs fire private.recompute_derived_prices() on their own trigger, so
  // calling them one after another is safe — the second run is cheap and
  // touches only rows the first one didn't already move.
  const { error: feeError } = await asCaller.rpc("set_usd_processing_fee", {
    p_fee_pct: parsed.data.usd_processing_fee_pct / 100,
  });
  if (feeError) return { error: feeError.message };

  const synced = await resyncDerivedRows(supabase);

  revalidatePath("/admin/settings/diaspora-pricing");
  revalidatePath("/admin/settings/subscriptions");
  revalidatePath("/pricing");

  if (synced.failed.length > 0) {
    return {
      error:
        `Rate saved and ${synced.ok} price${synced.ok === 1 ? "" : "s"} updated at the provider, but ` +
        `${synced.failed.length} could not be created and stay switched off: ` +
        `${synced.failed.slice(0, 3).join(", ")}${synced.failed.length > 3 ? "…" : ""}. ` +
        `Nothing is being sold at a stale price. Save again to retry just those.`,
    };
  }
  return {
    message:
      synced.ok === 0
        ? "Rate saved. No prices changed."
        : `Rate saved. ${synced.ok} price${synced.ok === 1 ? "" : "s"} rebuilt at Paystack/Stripe and switched back on.`,
  };
}

/**
 * Records that a person looked at the rate and it is still right.
 *
 * "Reviewed" and "changed" are different outcomes, and the common one is
 * reviewed-and-unchanged. Without a way to record that, the only way to clear
 * the review clock would be to move a price nobody wanted moved.
 *
 * Safe by construction, not by care: private.on_currency_rate_change only calls
 * recompute_derived_prices `if new.ngn_per_usd is distinct from old.ngn_per_usd`.
 * Re-saving the same number therefore moves updated_at and updated_by and
 * touches no price, no provider object, and nothing that is on sale. Verified
 * against the live trigger definition rather than assumed.
 */
export async function confirmRateReviewed(): Promise<DiasporaPricingState> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: settings } = await supabase
    .from("platform_currency_settings")
    .select("ngn_per_usd")
    .eq("id", true)
    .maybeSingle();

  const rate = settings?.ngn_per_usd == null ? null : Number(settings.ngn_per_usd);
  if (rate === null) {
    return { error: "There is no rate to confirm yet. Set one above first." };
  }

  const { error } = await supabase.rpc("set_usd_reference_rate", { p_ngn_per_usd: rate });
  if (error) return { error: error.message };

  revalidatePath("/admin/settings/diaspora-pricing");
  return { message: `Marked as reviewed today at ₦${rate.toLocaleString()} to $1. No price changed.` };
}

/** Retries the provider sync without touching the rate. */
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
 *
 * A derived row is skipped outright — never synced, never switched on — when
 * its own naira parent (`derived_from_code`) is itself off sale. That is a
 * deliberate product decision (a withdrawn or unbundled plan/add-on), not a
 * byproduct of the currency-rate change, and this function has no business
 * silently resurrecting it in another currency just because its Stripe price
 * happens to be missing too.
 */
async function resyncDerivedRows(
  supabase: ServiceClient
): Promise<{ ok: number; failed: string[] }> {
  let ok = 0;
  const failed: string[] = [];

  const [{ data: plans }, { data: addOns }, { data: activePlanCodes }, { data: activeAddOnCodes }] =
    await Promise.all([
      supabase
        .from("subscription_plans")
        .select(
          "id, code, name, price_minor, currency, interval, paystack_plan_code, stripe_price_id, stripe_product_id, derived_from_code"
        )
        .not("derived_from_code", "is", null)
        .is("stripe_price_id", null),
      supabase
        .from("add_ons")
        .select(
          "id, code, name, price_minor, currency, interval, paystack_plan_code, stripe_price_id, stripe_product_id, derived_from_code"
        )
        .not("derived_from_code", "is", null)
        .is("stripe_price_id", null),
      supabase.from("subscription_plans").select("code").eq("is_active", true).is("derived_from_code", null),
      supabase.from("add_ons").select("code").eq("is_active", true).is("derived_from_code", null),
    ]);

  const activeParentCodes = {
    subscription_plans: new Set((activePlanCodes ?? []).map((r) => r.code)),
    add_ons: new Set((activeAddOnCodes ?? []).map((r) => r.code)),
  };

  const batches = [
    { table: "subscription_plans" as const, rows: plans ?? [] },
    { table: "add_ons" as const, rows: addOns ?? [] },
  ];

  for (const { table, rows } of batches) {
    for (const row of rows) {
      if (!row.derived_from_code || !activeParentCodes[table].has(row.derived_from_code)) {
        continue;
      }
      // A derived row is always USD, so Stripe. The Paystack branch
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
