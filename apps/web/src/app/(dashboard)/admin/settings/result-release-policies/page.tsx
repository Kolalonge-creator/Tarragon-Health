import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import {
  ResultReleasePoliciesManager,
  type ResultReleasePolicyVersionRow,
} from "./result-release-policies-manager";

/**
 * Clinical Director sign-off for the result_release_policies config table
 * (Result Lifecycle §58.13) — the governed switch controlling whether a
 * patient can read a screening result on their own dashboard the instant
 * it's recorded, or whether it must wait for a doctor to deliver it
 * (screening_results_select RLS, private.patient_result_blocked). v1 is a
 * faithful transcription of the pre-existing screen_types.sensitive
 * catalogue — restriction applies only when the result is abnormal/critical,
 * a normal result of a restricted type still releases immediately. This
 * page is where a Clinical Director reviews the current config and puts a
 * signed record of that review on file, same discipline as
 * /admin/settings/escalation-slas.
 */
export default async function ResultReleasePoliciesSettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  const supabase = await createClient();
  const { data: versions } = await supabase
    .from("result_release_policies")
    .select("id, version, config, notes, is_active, approved_at, created_at")
    .order("version", { ascending: false });

  const versionRows = (versions as ResultReleasePolicyVersionRow[] | null) ?? [];
  const activeVersion = versionRows.find((v) => v.is_active) ?? null;
  const nextVersion = (versionRows[0]?.version ?? 0) + 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Result release policies
        </h1>
        <p className="text-charcoal-ink/60">
          Which screen types release to the patient immediately versus waiting for a doctor to
          deliver bad news in person (Result Lifecycle §58.13). A restriction only withholds an
          abnormal/critical result — a normal result of the same type always releases immediately.
          The list itself changes only through a reviewed, tested migration; this page is where a
          Clinical Director puts a signed record on file confirming the active configuration has
          been reviewed and approved.
        </p>
      </div>
      <ResultReleasePoliciesManager
        versions={versionRows}
        activeVersion={activeVersion}
        nextVersion={nextVersion}
      />
    </div>
  );
}
