import { createClient } from "@/lib/supabase/server";
import { LoadFailure } from "@/components/ui/load-failure";
import { PrnLimitRulesManager, type PrnLimitRulesVersionRow } from "./prn-limit-rules-manager";

/**
 * The as-needed limits sign-off panel: loads its own data and renders the real manager, values and Sign control
 * together. Shared by the CMO's own page and by the sign-off hub (/clinician/clinical-signoff), which opens it
 * inline so a signature is always given while looking at what is being signed. Access is gated by the page that
 * renders it (both require canAssignCases); the database refuses anyone but the active CMO at the sign step.
 */
export async function PrnLimitRulesPanel() {
  const supabase = await createClient();
  const { data: versions, error } = await supabase
    .from("prn_limit_rules")
    .select("id, version, config, notes, is_active, approved_at, approved_by, created_at")
    .order("version", { ascending: false });

  const rows = (versions as unknown as PrnLimitRulesVersionRow[] | null) ?? [];
  const activeVersion = rows.find((v) => v.is_active) ?? null;
  const nextVersion = (rows[0]?.version ?? 0) + 1;

  return (
    <div className="space-y-6">
      {error ? (
        <LoadFailure>
          The as-needed limits versions could not be loaded. This page cannot say which version is active or signed.
          Do not draft or sign anything from here until it loads.
        </LoadFailure>
      ) : (
        <PrnLimitRulesManager versions={rows} activeVersion={activeVersion} nextVersion={nextVersion} />
      )}
    </div>
  );
}
