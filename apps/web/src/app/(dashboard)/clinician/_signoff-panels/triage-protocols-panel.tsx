import { createClient } from "@/lib/supabase/server";
import {
  TriageProtocolsManager,
  type TriageProtocolVersionRow,
} from "@/app/(dashboard)/admin/settings/triage-protocols/triage-protocols-manager";

/**
 * The triage-protocols sign-off panel: loads its own data and renders the real manager,
 * values and Sign control together. Shared by the CMO's own page for this
 * config and by the sign-off hub (/clinician/clinical-signoff), which opens it
 * inline so a signature is always given while looking at the actual values.
 * Access is gated by the page that renders it (both require canAssignCases).
 */
export async function TriageProtocolsPanel() {
  const supabase = await createClient();
  const { data: versions, error: versionsError } = await supabase
    .from("triage_protocols")
    .select("id, version, config, notes, is_active, approved_at, approved_by, created_at")
    .order("version", { ascending: false });

  const versionRows = (versions as unknown as TriageProtocolVersionRow[] | null) ?? [];
  const activeVersion = versionRows.find((v) => v.is_active) ?? null;
  const nextVersion = (versionRows[0]?.version ?? 0) + 1;

  return (
    <div className="space-y-6">
      <TriageProtocolsManager
        versions={versionRows}
        activeVersion={activeVersion}
        nextVersion={nextVersion}
        loadFailed={versionsError !== null}
      />
    </div>
  );
}
