import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { latestUnreviewedRuns, type EvaluationRunRow } from "@/lib/ai-governance/evaluation-run-review";

export const EVALUATION_RUN_REVIEW_COLUMNS =
  "id, ai_system_id, suite_id, started_at, completed_at, outcome, total_cases, passed_cases, failed_cases, pass_rate_pct, environment, model_identifier, reviewed_at, ai_systems(name, system_code, is_enabled), ai_evaluation_suites(name, kind, is_active, is_required_for_release)";

/** More than every run the platform has made so far; the newest are read first, so a cut-off could only drop the oldest. */
const RUN_READ_LIMIT = 1000;

/**
 * The results the Chief Medical Officer still has to read: the newest finished run of each required test suite on each AI system
 * that is switched on, when nobody has recorded reading it (review_ai_evaluation_run). Shared by the sign-off hub's count and the
 * list on the AI governance panel so the two cannot drift. `failed` means a read failed, so `rows` may be short: never an all-clear.
 */
export async function readPendingAiEvaluationRunReviews(
  supabase: SupabaseClient<Database>
): Promise<{ rows: EvaluationRunRow[]; failed: boolean }> {
  const res = await supabase
    .from("ai_evaluation_runs")
    .select(EVALUATION_RUN_REVIEW_COLUMNS)
    .not("completed_at", "is", null)
    .not("outcome", "is", null)
    .order("started_at", { ascending: false })
    .limit(RUN_READ_LIMIT);
  if (res.error) return { rows: [], failed: true };
  return { rows: latestUnreviewedRuns((res.data ?? []) as unknown as EvaluationRunRow[]), failed: false };
}
