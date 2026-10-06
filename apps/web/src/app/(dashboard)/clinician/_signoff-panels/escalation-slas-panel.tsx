import { createClient } from "@/lib/supabase/server";
import {
  EscalationSlasManager,
  type EscalationSlaVersionRow,
} from "@/app/(dashboard)/admin/settings/escalation-slas/escalation-slas-manager";

/**
 * The escalation-slas sign-off panel: loads its own data and renders the real manager,
 * values and Sign control together. Shared by the CMO's own page for this
 * config and by the sign-off hub (/clinician/clinical-signoff), which opens it
 * inline so a signature is always given while looking at the actual values.
 * Access is gated by the page that renders it (both require canAssignCases).
 */
export async function EscalationSlasPanel() {
  const supabase = await createClient();
  const { data: versions, error: versionsError } = await supabase
    .from("escalation_slas")
    .select("id, version, config, notes, is_active, approved_at, created_at")
    .order("version", { ascending: false });

  // Same fail-closed discipline as the admin page: a swallowed error would
  // silently invite drafting a "v1" over the SLAs actually in force.
  const loadFailed = versionsError !== null;
  const versionRows = loadFailed ? [] : ((versions as EscalationSlaVersionRow[] | null) ?? []);
  const activeVersion = versionRows.find((v) => v.is_active) ?? null;
  const nextVersion = loadFailed ? null : (versionRows[0]?.version ?? 0) + 1;

  return (
    <div className="space-y-6">
      <EscalationSlasManager
        versions={versionRows}
        activeVersion={activeVersion}
        nextVersion={nextVersion}
        loadFailed={loadFailed}
      />
    </div>
  );
}
