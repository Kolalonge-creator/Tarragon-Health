import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
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
  const { data: configs, error: configsError } = await supabase
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
      <PageHeader
        title="Cardiovascular-risk configuration"
        description={
          <>
            These are the clinical parameters the lipid / CV-risk engine uses: LDL and Non-HDL
            targets by risk category, statin-eligibility thresholds, and the levels that flag a
            patient for review. They are seeded from published guidelines as a provisional draft and
            are <strong>not in force until the Medical Director signs them</strong>. Confirm the
            values, then sign to bring them into force. To change any value, edit below and save it as
            a new version, then sign it.
          </>
        }
      />
      {/* The editor prefills from the active config, falling back to the
          provisional published-guideline defaults. On a failed read that
          fallback is reached silently, so an administrator would have been
          editing on top of defaults while believing they were editing the
          signed version, and could save a new version that quietly reverts
          real clinical thresholds. The editor is withheld entirely rather
          than prefilled from a guess. */}
      {configsError ? (
        <LoadFailure>
          The cardiovascular-risk configuration could not be loaded. It is not missing, and this
          page cannot say which version is signed and in force. Do not save a new version from
          here until it loads: it would be written on top of provisional defaults rather than the
          current signed values.
        </LoadFailure>
      ) : (
        <>
          <CvRiskConfigEditor defaults={configToFormValues(prefillConfig)} />
          <CvRiskConfigManager configs={rows} />
        </>
      )}
    </div>
  );
}
