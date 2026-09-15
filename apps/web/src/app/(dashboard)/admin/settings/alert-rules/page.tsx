import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import { AlertRulesManager, type AlertRulesVersionRow } from "./alert-rules-manager";

/**
 * Clinical Director sign-off for the unified alert taxonomy (severity,
 * owner tier, ack timeout, channel sequence for every clinician_alerts
 * type_code the platform raises). Same discipline as
 * /admin/settings/escalation-slas and /admin/settings/triage-protocols: the
 * taxonomy lives in a versioned jsonb ledger reviewed and signed here, never
 * edited from this page directly — adding or changing an alert type goes
 * through a reviewed, tested migration.
 *
 * Unlike triage_protocols, this table ships active-but-unsigned (it
 * transcribed configuration already live in production, same posture as
 * escalation_slas) — so an unsigned version here is not a feature switched
 * off for patients, it is real, already-firing alert routing with no
 * Clinical Director attestation on file yet. This page previously did not
 * exist at all: clinical-rules/page.tsx's own comment claimed it did,
 * mirroring an "existing shape" that had never been built.
 */
export default async function AlertRulesSettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  const supabase = await createClient();
  const { data: versions, error: versionsError } = await supabase
    .from("alert_rules")
    .select("id, version, config, notes, is_active, approved_at, approved_by, created_at")
    .order("version", { ascending: false });

  const versionRows = (versions as unknown as AlertRulesVersionRow[] | null) ?? [];
  const activeVersion = versionRows.find((v) => v.is_active) ?? null;
  const nextVersion = (versionRows[0]?.version ?? 0) + 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alert Rules"
        description="The severity, owner tier, ack timeout, and delivery channels for every clinician alert type on the platform — abnormal results, vitals red flags, symptom escalation, medication safety, care-management follow-ups, and more. Content changes only through a reviewed, tested migration; this page is where a Clinical Director puts a signed record on file."
      />
      {versionsError ? (
        <LoadFailure>
          The alert_rules versions could not be loaded. This page cannot say which version is active,
          whether it is signed, or what the next version number should be. Do not draft a new version
          from here until it loads.
        </LoadFailure>
      ) : (
        <AlertRulesManager versions={versionRows} activeVersion={activeVersion} nextVersion={nextVersion} />
      )}
    </div>
  );
}
