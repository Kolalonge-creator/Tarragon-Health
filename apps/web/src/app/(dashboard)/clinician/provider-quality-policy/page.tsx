import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { ProviderQualityPolicyPanel } from "../_signoff-panels/provider-quality-policy-panel";

/**
 * The Chief Medical Officer / Clinical Director's own reachable path to
 * sign-off on the provider quality policy — the very policy that gates
 * whether the `clinical_quality` domain even appears on the CMO's own
 * /clinician/provider-quality dashboard (a CMO could not sign the policy
 * that unlocks their own quality view). Mirrors /clinician/protocols'
 * pattern exactly: admin/settings/provider-quality-policy/page.tsx
 * hard-redirects anyone whose `profiles.role !== "admin"`, and proxy.ts's
 * /admin/* gate refuses a plain `clinician` login before that page would
 * even load. Found 2026-09-22, same audit that found
 * provider_quality_policy_insert was admin-only RLS with no CMO fallback —
 * fixed in 20260922193027_cmo_governed_config_insert_dual_gate.sql, which
 * this page depends on for the "draft a new version" form to work.
 */
export default async function ClinicianProviderQualityPolicyPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) {
    redirect("/clinician");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Provider Quality Policy"
        description="Operating targets behind the provider quality dashboards: appointment/documentation/patient-experience metrics, the credential expiry ladder, and the intervention triggers a persistent shortfall or complaint leads to. Content changes only through a reviewed, tested migration; this page is where a Clinical Director puts a signed record on file."
      />
      <ProviderQualityPolicyPanel />
    </div>
  );
}
