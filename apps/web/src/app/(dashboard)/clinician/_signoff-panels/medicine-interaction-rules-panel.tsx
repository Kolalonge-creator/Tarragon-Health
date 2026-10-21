import { createClient } from "@/lib/supabase/server";
import { LoadFailure } from "@/components/ui/load-failure";
import { MedicineInteractionRulesManager, type MedicineInteractionRulesVersionRow } from "./medicine-interaction-rules-manager";

/**
 * The interaction rules sign-off panel: loads its own data and renders the real manager, rules and Sign control together. Shared by
 * the CMO's own page and the sign-off hub (/clinician/clinical-signoff), so a signature is always given while looking at the rules
 * being signed. Access is gated by the page that renders it; the database refuses anyone but the active CMO at the sign step.
 */
export async function MedicineInteractionRulesPanel() {
  const supabase = await createClient();
  const { data: versions, error } = await supabase
    .from("medicine_interaction_rule_sets")
    .select("id, version, config, notes, is_active, approved_at, approved_by, created_at")
    .order("version", { ascending: false });

  const rows = (versions as unknown as MedicineInteractionRulesVersionRow[] | null) ?? [];
  const activeVersion = rows.find((v) => v.is_active) ?? null;

  return (
    <div className="space-y-6">
      {error ? (
        <LoadFailure>
          The interaction rule versions could not be loaded. This page cannot say which version is active or signed. Do not draft or
          sign anything from here until it loads.
        </LoadFailure>
      ) : (
        <MedicineInteractionRulesManager versions={rows} activeVersion={activeVersion} />
      )}
    </div>
  );
}
