import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { CvRiskConfigManager, type CvRiskConfigRow } from "./cv-risk-config-manager";
import { CvRiskConfigEditor } from "./cv-risk-config-editor";
import { PROVISIONAL_CV_RISK_CONFIG, type CvRiskConfig } from "@/lib/rules/cv-risk";
import { configToFormValues } from "@/lib/validation/cv-risk-config";

/**
 * Medical-Director sign-off for the cardiovascular-risk configuration —
 * every LDL/Non-HDL target, statin-eligibility rule and escalation threshold
 * the CV-risk engine uses. Values are seeded as an unsigned provisional draft
 * and are NOT in force until a Clinical Director signs them here.
 */
export default async function CvRiskConfigSettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  const supabase = await createClient();
  const { data: configs } = await supabase
    .from("cv_risk_config")
    .select("id, version, config, notes, is_active, approved_at, created_at")
    .eq("organisation_id", profile.organisation_id ?? "")
    .order("version", { ascending: false });

  const rows = (configs as CvRiskConfigRow[] | null) ?? [];
  // Prefill the editor from the active config, else the latest version, else
  // the provisional defaults.
  const prefillConfig =
    (rows.find((r) => r.is_active)?.config as CvRiskConfig | undefined) ??
    (rows[0]?.config as CvRiskConfig | undefined) ??
    PROVISIONAL_CV_RISK_CONFIG;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Cardiovascular-risk configuration
        </h1>
        <p className="text-charcoal-ink/60">
          These are the clinical parameters the lipid / CV-risk engine uses — LDL and Non-HDL
          targets by risk category, statin-eligibility thresholds, and the levels that flag a
          patient for review. They are seeded from published guidelines as a provisional draft and
          are <strong>not in force until the Medical Director signs them</strong>. Confirm the
          values, then sign to bring them into force. To change any value, edit below and save it as
          a new version, then sign it.
        </p>
      </div>
      <CvRiskConfigEditor defaults={configToFormValues(prefillConfig)} />
      <CvRiskConfigManager configs={rows} />
    </div>
  );
}
