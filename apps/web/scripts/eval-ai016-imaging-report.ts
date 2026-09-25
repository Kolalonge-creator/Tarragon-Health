/**
 * CLI entry point for AI-016's one DB-registered governance evaluation
 * suite ("AI-016 golden imaging report extraction"). The real runner logic
 * (suite loading, fixture rendering, deterministic scoring) lives in
 * src/lib/ai-governance/run-imaging-eval-suites.ts, which the admin
 * console's "Run evaluations" button also calls -- this script is just the
 * CLI-specific concerns: an early friendlier error, a console summary, and
 * writing a local JSON file for manual inspection. Mirrors
 * ai-coach-governance-suites-eval.ts exactly for the same reason.
 *
 * This script does NOT write ai_evaluation_runs/ai_evaluation_case_results
 * itself -- recording a real run from a local run is still a reviewed
 * migration, same convention as the AI-001 script.
 *
 * Run: pnpm --filter @tarragon/web ai016-eval
 * Requires ANTHROPIC_API_KEY and a working Supabase service-role key (both
 * in apps/web/.env.local for local dev). Four real Sonnet 5 vision calls,
 * no judge -- well under $1.
 */

import { writeFile } from "node:fs/promises";
import { runAiImagingReportEvalSuites } from "../src/lib/ai-governance/run-imaging-eval-suites";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set. This eval makes real model calls and needs it.");
  process.exit(1);
}

async function main() {
  const startedAt = new Date().toISOString();
  const { suites: results } = await runAiImagingReportEvalSuites();
  const completedAt = new Date().toISOString();

  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(
      `${r.outcome === "pass" ? "PASS" : "FAIL"} ${r.suite_name}: ${r.passed_cases}/${r.total_cases} ` +
        `(threshold ${r.pass_threshold_pct}%)`
    );
  }

  const outPath = new URL("../ai016-imaging-eval-result.json", import.meta.url);
  await writeFile(
    outPath,
    JSON.stringify(
      { started_at: startedAt, completed_at: completedAt, model_identifier: "claude-sonnet-5", suites: results },
      null,
      2
    )
  );
  console.log(`\nFull results written to ${outPath.pathname}`);
  console.log(
    "\nThis script does not write to ai_evaluation_runs itself -- recording a real run is a reviewed " +
      "migration or the admin console's own action, same convention as AI-001's script."
  );
}

main().catch((error) => {
  console.error("eval-ai016-imaging-report failed:", error);
  process.exit(1);
});
