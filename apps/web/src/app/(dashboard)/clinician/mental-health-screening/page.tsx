import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import {
  MentalHealthScreeningManager,
  type ScreeningCadenceVersionRow,
} from "@/app/(dashboard)/admin/settings/mental-health-screening/mental-health-screening-manager";

/**
 * The Chief Medical Officer / Clinical Director's own reachable path to
 * sign-off on the mental-health screening cadences (PHQ-9/GAD-7/AUDIT-C
 * re-screen intervals, §46.5). Mirrors /clinician/protocols' pattern
 * exactly: admin/settings/mental-health-screening/page.tsx hard-redirects
 * anyone whose `profiles.role !== "admin"`, and proxy.ts's /admin/* gate
 * refuses a plain `clinician` login before that page would even load — so a
 * real CMO (account role always `clinician`) could not reach this at all,
 * even though sign_mental_health_screening_cadences has always been
 * Clinical-Director-only, never admin. Found 2026-09-22, same audit that
 * found mental_health_screening_cadences_insert was admin-only RLS with no
 * CMO fallback — fixed in
 * 20260922193027_cmo_governed_config_insert_dual_gate.sql, which this page
 * depends on for the "draft a new version" form to work.
 */
export default async function ClinicianMentalHealthScreeningPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) {
    redirect("/clinician");
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
