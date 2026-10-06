import { createClient } from "@/lib/supabase/server";
import { LoadFailure } from "@/components/ui/load-failure";
import {
  ProviderQualityPolicyManager,
  type ProviderQualityPolicyVersionRow,
} from "@/app/(dashboard)/admin/settings/provider-quality-policy/provider-quality-policy-manager";

/**
 * The provider-quality-policy sign-off panel: loads its own data and renders the real manager,
 * values and Sign control together. Shared by the CMO's own page for this
 * config and by the sign-off hub (/clinician/clinical-signoff), which opens it
 * inline so a signature is always given while looking at the actual values.
 * Access is gated by the page that renders it (both require canAssignCases).
 */
export async function ProviderQualityPolicyPanel() {
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
