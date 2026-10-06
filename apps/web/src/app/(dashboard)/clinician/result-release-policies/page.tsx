import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import {
  ResultReleasePoliciesManager,
  type ResultReleasePolicyVersionRow,
} from "@/app/(dashboard)/admin/settings/result-release-policies/result-release-policies-manager";

export const metadata = { title: "Result release policies" };

/**
 * The Chief Medical Officer's own reachable path to sign the result release
 * policy (which abnormal results wait for a doctor before the patient sees
 * them). The admin page is `role !== "admin"`-gated and unreachable for a
 * `clinician` login, and only a CMO may call `sign_result_release_policies`,
 * so before this page nobody could both open and sign it. Same manager and
 * same RPC; `canCreateDraft` is off because proposing a draft is an admin-only
 * write the CMO's account cannot perform, and the live version can be signed
 * in place.
 */
export default async function ClinicianResultReleasePoliciesPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) {
    redirect("/clinician");
  }

  const supabase = await createClient();
  const { data: versions, error } = await supabase
    .from("result_release_policies")
    .select("id, version, config, notes, is_active, approved_at, created_at")
    .order("version", { ascending: false });

  const rows = (versions as ResultReleasePolicyVersionRow[] | null) ?? [];
  const activeVersion = rows.find((v) => v.is_active) ?? null;
  const nextVersion = (rows[0]?.version ?? 0) + 1;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Result release policies"
        description="Which screen types release to the patient immediately and which wait for a doctor to deliver the result. A restriction only withholds an abnormal or critical result; a normal result always releases at once."
      />
      {/* A failed read must never read as "no restriction is active". */}
      {error ? (
        <LoadFailure>
          The result release policy could not be loaded. This is not proof that no restriction is
          active. Reload before assuming results are releasing immediately.
        </LoadFailure>
      ) : (
        <ResultReleasePoliciesManager
          versions={rows}
          activeVersion={activeVersion}
          nextVersion={nextVersion}
          canCreateDraft={false}
        />
      )}
    </div>
  );
}
