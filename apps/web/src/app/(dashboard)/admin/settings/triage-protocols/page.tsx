import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import {
  TriageProtocolsManager,
  type TriageProtocolVersionRow,
} from "./triage-protocols-manager";

/**
 * Clinical Director sign-off for the Symptom Assessment & Triage Engine's
 * governed protocol config (platform brief §37; supabase/migrations/
 * 20260829091247_symptom_triage_protocols_config.sql). Same discipline as
 * /admin/settings/escalation-slas: the red-flag thresholds and dynamic
 * questionnaire branching are clinical judgment, so they live in a
 * versioned jsonb ledger reviewed and signed here, never edited from this
 * page directly — a content change goes through a reviewed, tested
 * migration. Unlike escalation_slas, v1 seeded UNSIGNED and INACTIVE: the
 * patient-facing symptom checker stays off until a Director actually signs
 * a version here.
 */
export default async function TriageProtocolsSettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  const supabase = await createClient();
  const { data: versions } = await supabase
    .from("triage_protocols")
    .select("id, version, config, notes, is_active, approved_at, approved_by, created_at")
    .order("version", { ascending: false });

  const versionRows = (versions as unknown as TriageProtocolVersionRow[] | null) ?? [];
  const activeVersion = versionRows.find((v) => v.is_active) ?? null;
  const nextVersion = (versionRows[0]?.version ?? 0) + 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Symptom Triage Protocols</h1>
        <p className="text-charcoal-ink/60">
          The red-flag screening rules and dynamic question trees behind the patient-facing symptom
          checker (platform brief §37) — what counts as an emergency, what needs a prompt clinical
          look, and what&apos;s safe to self-manage, for each presenting complaint. Content changes
          only through a reviewed, tested migration; this page is where a Clinical Director puts a
          signed record on file and turns the patient-facing checker on.
        </p>
      </div>
      <TriageProtocolsManager versions={versionRows} activeVersion={activeVersion} nextVersion={nextVersion} />
    </div>
  );
}
