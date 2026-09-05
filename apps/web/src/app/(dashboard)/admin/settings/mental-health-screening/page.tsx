import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import {
  MentalHealthScreeningManager,
  type ScreeningCadenceVersionRow,
} from "./mental-health-screening-manager";

/**
 * Clinical Director sign-off for the mental-health screening cadences
 * (PHQ-9/GAD-7/AUDIT-C re-screen and post-concern follow-up intervals, §46.5).
 * Same discipline as /admin/settings/escalation-slas: the cadences live in a
 * versioned jsonb ledger reviewed and signed here, never edited from this
 * page directly — changing an interval goes through a reviewed, tested
 * migration.
 *
 * Ships active-but-unsigned, same posture as alert_rules/escalation_slas: it
 * transcribed a cadence already running (the existing Annual Health Check
 * schedule), so an unsigned version here is real, already-in-effect
 * screening timing with no Clinical Director attestation on file yet.
 */
export default async function MentalHealthScreeningSettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  const supabase = await createClient();
  const { data: versions, error: versionsError } = await supabase
    .from("mental_health_screening_cadences")
    .select("id, version, config, notes, is_active, approved_at, approved_by, created_at")
    .order("version", { ascending: false });

  const versionRows = (versions as unknown as ScreeningCadenceVersionRow[] | null) ?? [];
  const activeVersion = versionRows.find((v) => v.is_active) ?? null;
  const nextVersion = (versionRows[0]?.version ?? 0) + 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mental Health Screening Cadences"
        description="How often PHQ-9 (depression), GAD-7 (anxiety), and AUDIT-C (alcohol use) re-screen for a patient, and the shortened follow-up interval after a moderate/high concern band. Content changes only through a reviewed, tested migration; this page is where a Clinical Director puts a signed record on file."
      />
      {versionsError ? (
        <LoadFailure>
          The mental_health_screening_cadences versions could not be loaded. This page cannot say
          which version is active, whether it is signed, or what the next version number should be.
          Do not draft a new version from here until it loads.
        </LoadFailure>
      ) : (
        <MentalHealthScreeningManager versions={versionRows} activeVersion={activeVersion} nextVersion={nextVersion} />
      )}
    </div>
  );
}
