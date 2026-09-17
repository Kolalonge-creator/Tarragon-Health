import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import { PlatformCreditConfigManager, type PlatformCreditConfigRow } from "./platform-credit-config-manager";

export const metadata = { title: "Platform credit" };

/**
 * Admin control for public.platform_credit_config — the min/max top-up
 * bounds and the four suggested amounts shown on the patient-facing
 * PlatformCreditCard (₦10k/20k/50k/100k by default, see
 * 20260917100300_platform_credit_core_schema.sql). A true platform-wide
 * singleton (no per-organisation override, unlike growth_config/
 * lab-result-consult-pricing) — before this page existed the only way to
 * change any of these numbers was a migration, which for a tunable UI number
 * defeats the point of having one.
 */
export default async function PlatformCreditSettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");

  const supabase = await createClient();
  const { data: config, error } = await supabase
    .from("platform_credit_config")
    .select("min_topup_kobo, max_topup_kobo, suggested_amounts_kobo, updated_at")
    .eq("id", true)
    .maybeSingle();

  const row: PlatformCreditConfigRow | null = config
    ? {
        minTopupKobo: config.min_topup_kobo,
        maxTopupKobo: config.max_topup_kobo,
        suggestedAmountsKobo: config.suggested_amounts_kobo ?? [],
        updatedAt: config.updated_at,
      }
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform credit"
        description="The prepaid balance a patient can fund once and spend on any paid service later — never expires, never cashed out. This controls the top-up bounds and the quick-pick amounts shown on their dashboard; it does not touch any individual patient&apos;s balance."
      />
      {error || !row ? (
        <LoadFailure>
          The platform credit configuration could not be loaded. This is not a report that no
          configuration exists — it is a singleton row seeded by the feature&apos;s own migration, so a
          blank screen here almost certainly means a read error, not a missing row. Reload before
          editing anything.
        </LoadFailure>
      ) : (
        <PlatformCreditConfigManager config={row} />
      )}
    </div>
  );
}
