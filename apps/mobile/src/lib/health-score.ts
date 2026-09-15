import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { HealthScoreRiskLevel } from "./health-status";

export interface LatestHealthScore {
  score: number;
  riskLevel: HealthScoreRiskLevel;
}

/**
 * Mirrors useLatestHealthScore in apps/web/src/lib/queries/health-score.ts.
 * The score itself is computed and written server-side by
 * assessHealthScoreBestEffort (apps/web/src/lib/health-score/assess-health-score.ts),
 * triggered off the same POST /api/mobile/vitals route this app already
 * calls when a patient logs a reading -- so there is no scoring rule to
 * duplicate on the client, only this read.
 */
export async function getLatestHealthScore(
  patientId: string
): Promise<QueryResult<LatestHealthScore | null>> {
  try {
    const { data, error } = await supabase
      .from("patient_risk_scores")
      .select("score, risk_level")
      .eq("patient_id", patientId)
      .eq("score_type", "health_score")
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data || data.score === null || !data.risk_level) return { ok: true, data: null };
    return {
      ok: true,
      data: { score: data.score, riskLevel: data.risk_level as HealthScoreRiskLevel },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
