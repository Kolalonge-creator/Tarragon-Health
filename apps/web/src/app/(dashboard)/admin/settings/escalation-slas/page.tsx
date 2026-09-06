import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  EscalationSlasManager,
  type EscalationSlaVersionRow,
} from "./escalation-slas-manager";

/**
 * Clinical Director sign-off for the escalation_slas config table (v3 port,
 * 2026-07-30) — the single place every clinician_alert-raising trigger reads
 * its SLA from, instead of a hardcoded interval buried in each function.
 * v1 is a faithful, zero-behaviour-change transcription of what was already
 * live in production; the numbers themselves change only through a reviewed,
 * tested migration (same discipline as /admin/settings/vaccination-schedule).
 * This page is where a Clinical Director reviews the current config and
 * puts a signed record of that review on file.
 */
export default async function EscalationSlasSettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  const supabase = await createClient();
  const { data: versions, error: versionsError } = await supabase
    .from("escalation_slas")
    .select("id, version, config, notes, is_active, approved_at, created_at")
    .order("version", { ascending: false });

  // A swallowed error here was worse than a blank page. It produced an empty
  // versions list, which made the page say "No active configuration found"
  // while a live config was driving sla_due_at on every abnormal-result
  // alert on the platform, and it made nextVersion compute to 1 — inviting a
  // Clinical Director to draft and sign a "v1" over the SLAs actually in
  // force. Both claims are only safe off a read we know succeeded, so the
  // next version number is derived only when there is no error, and is null
  // otherwise rather than falling back to a number.
  const loadFailed = versionsError !== null;
  const versionRows = loadFailed ? [] : ((versions as EscalationSlaVersionRow[] | null) ?? []);
  const activeVersion = versionRows.find((v) => v.is_active) ?? null;
  const nextVersion = loadFailed ? null : (versionRows[0]?.version ?? 0) + 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Escalation SLAs"
        description='The contact-time commitment every clinician_alert is raised against, by care pathway and urgency tier. This drives sla_due_at on every abnormal-result, red-flag-vitals, emergency, and "silence is not assumed safe" alert on the platform. The numbers change only through a reviewed, tested migration; this page is where a Clinical Director puts a signed record on file confirming the active configuration has been reviewed and approved.'
      />
      <EscalationSlasManager
        versions={versionRows}
        activeVersion={activeVersion}
        nextVersion={nextVersion}
        loadFailed={loadFailed}
      />
    </div>
  );
}
