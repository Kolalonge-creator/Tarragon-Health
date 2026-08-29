import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/permissions";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { FeatureFlagsManager, type FeatureFlagRow, type FeatureFlagRuleRow } from "./feature-flags-manager";

/**
 * Module 30.21 — rollout control. Distinct from
 * private.patient_has_feature_access() (plan entitlement, unchanged) — see
 * the migration comment on public.feature_flags for the full split. A
 * clinical-safety path (abnormal-result upgrade, emergency handling,
 * red-flag detection, escalation SLAs) cannot be created as a flag at all;
 * the DB enforces that with a trigger, not this page.
 */
export default async function FeatureFlagsPage() {
  const profile = await getCurrentProfile();
  const canManage = profile?.role === "admin" || (await hasPermission("feature_flags.manage"));

  const supabase = await createClient();
  const [{ data: flags }, { data: rules }] = await Promise.all([
    supabase.from("feature_flags").select("*").order("key"),
    supabase.from("feature_flag_rules").select("*").order("created_at", { ascending: false }),
  ]);

  if (!flags) {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Feature flags</h1>
        <p className="text-charcoal-ink/60">
          Turn a feature on or off, roll it out to a state, a role, an organisation, or a
          percentage of patients — without a deploy. This is rollout control, separate from plan
          entitlement (a patient can be flagged in and still need the right subscription).
          Clinical-safety paths can never be flagged here — that guard is in the database.
        </p>
      </div>
      <FeatureFlagsManager
        initialFlags={(flags ?? []) as FeatureFlagRow[]}
        initialRules={(rules ?? []) as FeatureFlagRuleRow[]}
        canManage={canManage}
      />
    </div>
  );
}
