import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import { GrowthConfigManager, type GrowthConfigRow } from "./growth-config-manager";

/**
 * Admin control for public.growth_config — the referral reward (kobo,
 * credited to both referrer and referred) and the apply window (days a new
 * joiner may still apply someone's code), read by
 * public.redeem_referral_code. Added 2026-09-10 alongside the column itself
 * (20260910011850_growth_config_and_credit_validity.sql) specifically to
 * replace the two literals that used to be welded into that function's body
 * — without an admin screen, the migration's whole point (tuning the
 * platform's principal growth lever without a deploy) was unmet. Same
 * platform-default + per-organisation-override shape as
 * /admin/settings/lab-result-consult-pricing, the closest real precedent for
 * a two-row-type config table with RLS gated to private.is_admin().
 */
export default async function GrowthConfigSettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");

  const supabase = await createClient();

  const [{ data: configRows, error: configError }, { data: organisations }] = await Promise.all([
    supabase
      .from("growth_config")
      .select("id, organisation_id, referral_reward_kobo, referral_apply_window_days, updated_at")
      .order("organisation_id", { ascending: true, nullsFirst: true }),
    supabase.from("organisations").select("id, name").order("name"),
  ]);

  const orgNameById = new Map((organisations ?? []).map((o) => [o.id, o.name]));
  const rows: GrowthConfigRow[] = (configRows ?? []).map((r) => ({
    id: r.id,
    organisationId: r.organisation_id,
    organisationName: r.organisation_id ? (orgNameById.get(r.organisation_id) ?? "Unknown org") : null,
    referralRewardKobo: r.referral_reward_kobo,
    referralApplyWindowDays: r.referral_apply_window_days,
    updatedAt: r.updated_at,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Referral & growth config"
        description="The referral reward (credited to both referrer and referred once the referred patient completes their first paid order) and the window a new joiner may still apply a code. One platform-default row, with optional per-organisation overrides. Any change here should also be reflected in the marketing pricing copy and the gift page, which state the figure in words."
      />
      {configError ? (
        <LoadFailure>
          The growth configuration could not be loaded. This is not a report that no configuration
          exists — public.redeem_referral_code falls back to its own hardcoded defaults (₦500, 30
          days) if this table is ever unreadable, so a live reward may differ from what a blank
          screen here would suggest. Reload before editing anything.
        </LoadFailure>
      ) : (
        <GrowthConfigManager
          rows={rows}
          organisations={(organisations ?? []).map((o) => ({ id: o.id, name: o.name }))}
        />
      )}
    </div>
  );
}
