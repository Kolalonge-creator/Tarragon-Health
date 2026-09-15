import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import {
  ProviderQualityPolicyManager,
  type ProviderQualityPolicyVersionRow,
} from "./provider-quality-policy-manager";

/**
 * Clinical Director sign-off for the provider quality policy — the
 * operational/documentation/patient-experience/clinical-quality metric
 * targets, credential expiry ladder, and intervention triggers behind the
 * provider quality dashboards. Same discipline as
 * /admin/settings/escalation-slas: the policy lives in a versioned jsonb
 * ledger reviewed and signed here, never edited from this page directly.
 *
 * Every `clinical_quality` metric ships `clinically_governed: false` on
 * purpose (v1 notes) — no provider-level clinical quality measure has been
 * validated yet, so most of what this policy drives is a management target,
 * not a clinical standard. Ships active-but-unsigned, same posture as
 * alert_rules/escalation_slas.
 */
export default async function ProviderQualityPolicySettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  const supabase = await createClient();
  const { data: versions, error: versionsError } = await supabase
    .from("provider_quality_policy")
    .select("id, version, config, notes, is_active, approved_at, approved_by, created_at")
    .order("version", { ascending: false });

  const versionRows = (versions as unknown as ProviderQualityPolicyVersionRow[] | null) ?? [];
  const activeVersion = versionRows.find((v) => v.is_active) ?? null;
  const nextVersion = (versionRows[0]?.version ?? 0) + 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Provider Quality Policy"
        description="Operating targets behind the provider quality dashboards: appointment/documentation/patient-experience metrics, the credential expiry ladder, and the intervention triggers a persistent shortfall or complaint leads to. Content changes only through a reviewed, tested migration; this page is where a Clinical Director puts a signed record on file."
      />
      {versionsError ? (
        <LoadFailure>
          The provider_quality_policy versions could not be loaded. This page cannot say which
          version is active, whether it is signed, or what the next version number should be. Do not
          draft a new version from here until it loads.
        </LoadFailure>
      ) : (
        <ProviderQualityPolicyManager versions={versionRows} activeVersion={activeVersion} nextVersion={nextVersion} />
      )}
    </div>
  );
}
