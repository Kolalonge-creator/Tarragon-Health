import { redirect } from "next/navigation";
import { getCurrentProfile, getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import {
  CvRiskConfigManager,
  type CvRiskConfigRow,
} from "@/app/(dashboard)/admin/settings/cv-risk-config/cv-risk-config-manager";
import { CvRiskConfigEditor } from "@/app/(dashboard)/admin/settings/cv-risk-config/cv-risk-config-editor";
import { PROVISIONAL_CV_RISK_CONFIG, type CvRiskConfig } from "@/lib/rules/cv-risk";
import { configToFormValues } from "@/lib/validation/cv-risk-config";

/**
 * The Chief Medical Officer / Clinical Director's own reachable path to
 * sign-off on the cardiovascular-risk configuration. Mirrors
 * /clinician/protocols' pattern exactly: admin/settings/cv-risk-config/
 * page.tsx hard-redirects anyone whose `profiles.role !== "admin"`, and
 * proxy.ts's /admin/* gate refuses a plain `clinician` login before that
 * page would even load — so a real CMO (account role always `clinician`)
 * could not reach this at all, even though sign_cv_risk_config has always
 * been Clinical-Director-only, never admin. Found 2026-09-22. Unlike the 5
 * config tables fixed by 20260922193027_cmo_governed_config_insert_dual_
 * gate.sql, cv_risk_config's own INSERT policy was already
 * private.is_org_staff()-scoped (admits any staff clinician), so only this
 * page and the app-layer check in cv-risk-config/actions.ts needed fixing.
 */
export default async function ClinicianCvRiskConfigPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) {
    redirect("/clinician");
  }
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
      <PageHeader
        title="Cardiovascular-risk configuration"
        description={
          <>
            These are the clinical parameters the lipid / CV-risk engine uses: LDL and Non-HDL
            targets by risk category, statin-eligibility thresholds, and the levels that flag a
            patient for review. They are seeded from published guidelines as a provisional draft and
            are <strong>not in force until the Clinical Director signs them</strong>. Confirm the
            values, then sign to bring them into force. To change any value, edit below and save it as
            a new version, then sign it.
          </>
        }
      />
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
