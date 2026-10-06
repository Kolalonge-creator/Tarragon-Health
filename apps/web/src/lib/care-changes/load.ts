import { parseCareChanges, type CareChange } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";

export type CareChangesResult = { ok: true; changes: CareChange[] } | { ok: false };

/**
 * The signed changes the care team has for the signed-in patient, from the patient-only RPC (it never returns a
 * draft, and never a clinical rationale). A failed read is reported, not turned into an empty list: an empty list
 * would read as "nothing for me" when a change may be waiting.
 */
export async function loadMyCareChanges(): Promise<CareChangesResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_care_plan_changes");
  if (error) return { ok: false };
  return { ok: true, changes: parseCareChanges(data) };
}
