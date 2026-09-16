/**
 * CLI entry point for AI-001's four DB-registered governance evaluation
 * suites. The real runner logic (suite loading, judges, per-suite scoring)
 * lives in src/lib/ai-governance/run-coach-eval-suites.ts, which the admin
 * console's "Run evaluations" button also calls -- this script is now just
 * the CLI-specific concerns: an early friendlier error, a console summary,
 * and writing a local JSON file for manual inspection.
 *
 * This script does NOT write ai_evaluation_runs/ai_evaluation_case_results
 * itself -- recording a run from a local run is still a reviewed migration
 * (see e.g. supabase/migrations/20260914215104_record_ai001_governance_
 * suite_eval_runs.sql for the pattern). The admin console's server action
 * records a run itself, since it runs as an authenticated admin action
 * against RLS-protected tables rather than a local dev script.
 *
 * Run: pnpm --filter @tarragon/web ai-coach-governance-eval
 * Requires ANTHROPIC_API_KEY and a working Supabase service-role key (both
 * already in apps/web/.env.local for local dev). Roughly 14 paid Sonnet 5
 * calls + up to 14 Haiku 4.5 judge calls -- well under $1 total.
 */

import { writeFile } from "node:fs/promises";
import { runAiCoachGovernanceSuites } from "../src/lib/ai-governance/run-coach-eval-suites";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set. This eval makes real model calls and needs it.");
  process.exit(1);
}

async function main() {
  const startedAt = new Date().toISOString();
  const { suites: results } = await runAiCoachGovernanceSuites();
  const completedAt = new Date().toISOString();

  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(
      `${r.outcome === "pass" ? "PASS" : "FAIL"} ${r.suite_name}: ${r.passed_cases}/${r.total_cases} ` +
        `(threshold ${r.pass_threshold_pct}%)`
    );
  }

  const outPath = new URL("../ai-coach-governance-eval-result.json", import.meta.url);
  await writeFile(
    outPath,
    JSON.stringify({ started_at: startedAt, completed_at: completedAt, model_identifier: "claude-sonnet-5", suites: results }, null, 2)
  );
  console.log(`\nFull results written to ${outPath.pathname}`);
  console.log(
    "\nThis script does not write to ai_evaluation_runs itself -- recording a real run is a reviewed " +
      "migration, see supabase/migrations/20260914215104_record_ai001_governance_suite_eval_runs.sql for the pattern."
  );
}

main().catch((error) => {
  console.error("ai-coach-governance-suites-eval failed:", error);
  process.exit(1);
});
