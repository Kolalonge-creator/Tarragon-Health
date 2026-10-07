import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { RiskQuestionnaireConfigPanel } from "../_signoff-panels/risk-questionnaire-config-panel";

/**
 * The Chief Medical Officer / Clinical Director's own reachable path to
 * sign-off on the prevention risk questionnaire configuration. Mirrors
 * /clinician/protocols' pattern exactly: admin/settings/risk-questionnaire-
 * config/page.tsx hard-redirects anyone whose `profiles.role !== "admin"`,
 * and proxy.ts's /admin/* gate refuses a plain `clinician` login before
 * that page would even load. Found 2026-09-22. Unlike the 5 config tables
 * fixed by 20260922193027_cmo_governed_config_insert_dual_gate.sql,
 * risk_questionnaire_configs' own INSERT policy was already
 * private.is_org_staff()-scoped (admits any staff clinician), so only this
 * page and the app-layer check in risk-questionnaire-config/actions.ts
 * needed fixing.
 */
export default async function ClinicianRiskQuestionnaireConfigPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) {
    redirect("/clinician");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Risk questionnaire configuration"
        description={
          <>
            The question bank and per-condition scoring rules behind every patient&apos;s risk
            assessment, including which questions branch on earlier answers, and the points/
            thresholds that produce a Low/Moderate/High/Unknown tier per condition. The seeded
            version is a verbatim port of the platform&apos;s existing built-in logic (zero clinical
            change) and is{" "}
            <strong>not in force until a Clinical Director signs it</strong>. Review it, then sign
            to switch the live risk assessment onto this configuration.
          </>
        }
      />
      <RiskQuestionnaireConfigPanel />
    </div>
  );
}
