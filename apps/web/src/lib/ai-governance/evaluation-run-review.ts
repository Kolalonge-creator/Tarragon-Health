export type EvaluationRunRow = {
  id: string;
  ai_system_id: string;
  suite_id: string;
  started_at: string;
  completed_at: string | null;
  outcome: "pass" | "fail" | "needs_review" | null;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  pass_rate_pct: number | string | null;
  environment: string;
  model_identifier: string | null;
  reviewed_at: string | null;
  ai_systems: { name: string; system_code: string; is_enabled: boolean } | null;
  ai_evaluation_suites: { name: string; kind: string; is_active: boolean; is_required_for_release: boolean } | null;
};

/**
 * From runs ordered newest first, keep the newest finished run of each (system, suite) pair, and of those only the ones nobody has
 * reviewed, for suites that are active and required for release on AI systems that are switched on. An older unreviewed run behind a
 * newer reviewed one is history, not work: it is dropped. A run with no outcome is not a result yet and is never listed.
 */
export function latestUnreviewedRuns(rowsNewestFirst: readonly EvaluationRunRow[]): EvaluationRunRow[] {
  const seen = new Set<string>();
  const out: EvaluationRunRow[] = [];
  for (const r of rowsNewestFirst) {
    if (r.completed_at === null || r.outcome === null) continue;
    const key = `${r.ai_system_id}:${r.suite_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (r.reviewed_at !== null) continue;
    if (!r.ai_systems?.is_enabled) continue;
    if (!r.ai_evaluation_suites?.is_active || !r.ai_evaluation_suites.is_required_for_release) continue;
    out.push(r);
  }
  return out;
}
