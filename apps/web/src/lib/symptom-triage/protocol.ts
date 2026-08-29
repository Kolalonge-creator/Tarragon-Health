import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import type { ActiveTriageProtocol, TriageProtocolConfig } from "./types";

/**
 * The active, signed protocol -- or null. triage_protocols has exactly one
 * draft/unsigned row as of this writing (is_active: false, approved_by:
 * null); RLS lets anyone read triage_protocols, but nothing here or in the
 * caller ever treats an unsigned row as active. A patient asking to use the
 * symptom checker before one is signed sees a plain "not yet available"
 * message (checkSymptomTriagePathwaysAction), same as case-briefs when no
 * signed protocol is in force for a condition.
 */
export async function getActiveProtocol(
  supabase: SupabaseClient<Database>
): Promise<ActiveTriageProtocol | null> {
  const { data, error } = await supabase
    .from("triage_protocols")
    .select("id, version, config")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return { id: data.id, version: data.version, config: data.config as unknown as TriageProtocolConfig };
}
