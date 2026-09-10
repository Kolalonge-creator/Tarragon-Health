"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { nairaToKobo } from "@tarragon/shared";

export type GrowthConfigState = { error?: string; message?: string } | undefined;

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") throw new Error("Admin access required");
  return profile;
}

// Mirrors growth_config_reward_sane (0 to 10,000,000 kobo) and
// growth_config_window_sane (1 to 365 days) from
// 20260910011850_growth_config_and_credit_validity.sql — validated here too
// so a bad value comes back as a real form error instead of a raw Postgres
// CHECK-violation string.
const saveSchema = z.object({
  organisationId: z.string().uuid().nullable(),
  rewardNaira: z.coerce.number().min(0).max(100_000),
  windowDays: z.coerce.number().int().min(1).max(365),
});

/**
 * Upserts the platform-default row (organisationId null) or one
 * organisation's override, matching the same platform-default +
 * per-organisation-override shape as
 * admin/settings/lab-result-consult-pricing/actions.ts. Runs through the
 * admin's own session — growth_config_write's RLS policy gates on
 * private.is_admin() — so a service-role client (no auth.uid()) would be
 * rejected the same way diaspora-pricing/actions.ts documents.
 *
 * public.redeem_referral_code reads whichever row applies at call time (org
 * row first, else the null-organisation platform default), so this is the
 * only place either number is ever set.
 */
export async function saveGrowthConfig(
  _prev: GrowthConfigState,
  formData: FormData,
): Promise<GrowthConfigState> {
  const profile = await requireAdmin();

  const rawOrgId = String(formData.get("organisation_id") ?? "");
  const parsed = saveSchema.safeParse({
    organisationId: rawOrgId ? rawOrgId : null,
    rewardNaira: formData.get("reward_naira"),
    windowDays: formData.get("window_days"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the values and try again." };
  }
  const { organisationId, rewardNaira, windowDays } = parsed.data;
  const rewardKobo = nairaToKobo(rewardNaira);

  const supabase = await createClient();

  const existingQuery = supabase.from("growth_config").select("id");
  const { data: existing } = await (
    organisationId
      ? existingQuery.eq("organisation_id", organisationId)
      : existingQuery.is("organisation_id", null)
  ).maybeSingle();

  const { error } = existing
    ? await supabase
        .from("growth_config")
        .update({
          referral_reward_kobo: rewardKobo,
          referral_apply_window_days: windowDays,
          updated_by: profile.id,
        })
        .eq("id", existing.id)
    : await supabase.from("growth_config").insert({
        organisation_id: organisationId,
        referral_reward_kobo: rewardKobo,
        referral_apply_window_days: windowDays,
        updated_by: profile.id,
      });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/settings/growth-config");
  return {
    message: organisationId ? "Organisation override saved." : "Platform-default growth config saved.",
  };
}
