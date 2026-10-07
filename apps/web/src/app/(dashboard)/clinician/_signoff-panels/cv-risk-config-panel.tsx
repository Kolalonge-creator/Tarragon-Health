import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { LoadFailure } from "@/components/ui/load-failure";
import {
  CvRiskConfigManager,
  type CvRiskConfigRow,
} from "@/app/(dashboard)/admin/settings/cv-risk-config/cv-risk-config-manager";
import { CvRiskConfigEditor } from "@/app/(dashboard)/admin/settings/cv-risk-config/cv-risk-config-editor";
import { PROVISIONAL_CV_RISK_CONFIG, type CvRiskConfig } from "@/lib/rules/cv-risk";
import { configToFormValues } from "@/lib/validation/cv-risk-config";

/**
 * The cv-risk-config sign-off panel: loads its own data and renders the real editor and
 * manager, values and Sign control together. Shared by the CMO's own page for
 * this config and by the sign-off hub (/clinician/clinical-signoff), which opens
 * it inline so a signature is always given while looking at the actual values.
 * Access is gated by the page that renders it (both require canAssignCases).
 */
export async function CvRiskConfigPanel() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const { data: configs, error: configsError } = await supabase
    .from("cv_risk_config")
    .select("id, version, config, notes, is_active, approved_at, created_at")
    .eq("organisation_id", profile?.organisation_id ?? "")
    .order("version", { ascending: false });

  const rows = (configs as CvRiskConfigRow[] | null) ?? [];
  const prefillConfig =
    (rows.find((r) => r.is_active)?.config as CvRiskConfig | undefined) ??
    (rows[0]?.config as CvRiskConfig | undefined) ??
    PROVISIONAL_CV_RISK_CONFIG;

  return (
    <div className="space-y-6">
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
