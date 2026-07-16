import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export type CostAvoidedEstimate = {
  estimatedKobo: number;
  perCatchKobo: number;
  isEstimate: true;
};

/**
 * "Estimated cost avoided" is a modeled figure (abnormal findings caught
 * early x a per-catch estimate from cohort_cost_model_constants), never a
 * real claims-integration number — Tarragon has no HMO claims data feed.
 * Every call site rendering this MUST show a visible "modeled estimate,
 * not a real claims feed" label — see CARE_GAP_ESTIMATE_DISCLAIMER.
 */
export async function estimateCostAvoided(
  supabase: SupabaseClient<Database>,
  organisationId: string,
  abnormalFindingsCount: number
): Promise<CostAvoidedEstimate> {
  const { data: orgRow } = await supabase
    .from("cohort_cost_model_constants")
    .select("estimated_cost_avoided_per_abnormal_catch_kobo")
    .eq("organisation_id", organisationId)
    .maybeSingle();

  let perCatchKobo = orgRow?.estimated_cost_avoided_per_abnormal_catch_kobo ?? null;

  if (perCatchKobo === null) {
    const { data: defaultRow } = await supabase
      .from("cohort_cost_model_constants")
      .select("estimated_cost_avoided_per_abnormal_catch_kobo")
      .is("organisation_id", null)
      .maybeSingle();
    perCatchKobo = defaultRow?.estimated_cost_avoided_per_abnormal_catch_kobo ?? 0;
  }

  return {
    estimatedKobo: abnormalFindingsCount * perCatchKobo,
    perCatchKobo,
    isEstimate: true,
  };
}

export const CARE_GAP_ESTIMATE_DISCLAIMER =
  "Modeled estimate — not a real claims feed. Based on abnormal findings caught early x an admin-configurable per-catch figure.";
