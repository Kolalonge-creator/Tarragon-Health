import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { ClinicalTrialsManager, type TrialRow } from "./clinical-trials-manager";

/**
 * Clinical-trials patient matching (spec §12.15) — deliberately gated
 * per-trial on its OWN ethics-committee approval (ethics_approved_at),
 * never on the unrelated population_data_governance_gates (that migration's
 * 3 gates govern already-collected data reuse, not whether a specific
 * research study may identify real patients at all — a separate,
 * NHREC-or-equivalent decision made per study). No trial exists until an
 * admin creates one here; the matching preview stays blocked, and returns a
 * count only, never patient identities, even once approved — see
 * supabase/migrations/20260830130221_clinical_trial_matching_gated_on_ethics_approval.sql.
 */
export default async function ClinicalTrialsMatchingPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("clinical_trials")
    .select(
      "id, name, sponsor, protocol_reference, status, ethics_committee_name, ethics_reference, ethics_approved_at, created_at"
    )
    .order("created_at", { ascending: false });

  const trials = (data as TrialRow[] | null) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Clinical trials matching
        </h1>
        <p className="text-charcoal-ink/60">
          Internal-only scaffolding for the §12.15 clinical-trials capability. Reuses the same
          eligibility-rule DSL as prevention campaigns, evaluated server-side across all patients —
          but every trial starts with no ethics-committee approval on file, and the matching preview
          refuses to return anything but a blocked response until that specific trial&apos;s approval
          is attested. Even once approved, only a count is ever returned — never patient identities.
        </p>
      </div>
      <ClinicalTrialsManager trials={trials} />
    </div>
  );
}
