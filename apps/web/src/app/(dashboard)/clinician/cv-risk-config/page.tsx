import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { CvRiskConfigPanel } from "../_signoff-panels/cv-risk-config-panel";

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
      <CvRiskConfigPanel />
    </div>
  );
}
