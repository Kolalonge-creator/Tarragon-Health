import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export interface PatientContext {
  /** Prevention conditions currently tiered above 'low', for a personalised
   * (not generic) reply — e.g. so the coach can say "since your diabetes
   * risk is elevated" rather than nothing. */
  elevatedConditions: string[];
}

/** Best-effort grounding snapshot. Never throws — a coach turn should still
 * proceed on generic advice if this lookup fails. */
export async function loadPatientContext(
  supabase: SupabaseClient<Database>,
  profileId: string
): Promise<PatientContext> {
  const { data } = await supabase
    .from("prevention_risk_scores")
    .select("condition, tier")
    .eq("profile_id", profileId)
    .neq("tier", "low");

  return { elevatedConditions: (data ?? []).map((row) => row.condition) };
}
