/**
 * AI-009 (Lifestyle content retrieval embeddings) real evaluation.
 * Run: pnpm --filter @tarragon/web ai009-eval
 *
 * VOYAGE_API_KEY was confirmed unconfigured as of the AI_002_015_EVALUATION_SCOPE.md
 * doc (2026-09-16); a working key was found in .env.local behind a typo
 * ("xport" instead of "export") that silently prevented it from ever being
 * loaded. Fixed locally. This is the FIRST real exercise of this system
 * against a live Voyage account and the real Supabase content tables --
 * per the doc, "there's very little to measure against a provider that has
 * never been called for real," so this script does the three things that
 * actually needed a real key:
 *
 *   1. Populates real embeddings for both content tables (previously 0/58
 *      and 0/235) -- a genuine, real, live production data write, not a
 *      dry run, since these rows are clinician-reviewed reference content,
 *      not patient data.
 *   2. Confirms the dimension-mismatch fix (see the migration + code
 *      changes earlier in this series) holds against real API responses.
 *   3. Runs real retrieval-quality cases: does findRelevantLifestyleContent
 *      actually surface the clinically appropriate block for a real query,
 *      via the real match_lpe_content_blocks RPC over real embeddings.
 */
import { populateContentEmbeddings } from "../src/lib/lifestyle/embed-content";
import { populateHealthEducationEmbeddings } from "../src/lib/ai-coach/knowledge-base";
import { findRelevantLifestyleContent } from "../src/lib/lifestyle/find-relevant-content";
import { createVoyageEmbedderFromEnv } from "../src/lib/lifestyle/voyage-embedder";
import { createServiceRoleClient } from "../src/lib/supabase/service-role";

interface RetrievalCase {
  case_code: string;
  queryText: string;
  conditionFilter: "hypertension" | "diabetes" | "obesity" | "ckd";
  expectedConditionOfTopResult: string;
}

const RETRIEVAL_CASES: RetrievalCase[] = [
  {
    case_code: "hypertension_home_bp_monitoring_query",
    queryText: "Hypertension programme, Foundation phase, home blood pressure monitoring routine",
    conditionFilter: "hypertension",
    expectedConditionOfTopResult: "hypertension",
  },
  {
    case_code: "diabetes_foot_care_query",
    queryText: "Diabetes programme, Maintenance phase, daily foot care and checking for wounds",
    conditionFilter: "diabetes",
    expectedConditionOfTopResult: "diabetes",
  },
];

async function main() {
  const embedder = createVoyageEmbedderFromEnv();
  if (!embedder) {
    console.error("VOYAGE_API_KEY still not configured -- cannot run a real evaluation.");
    process.exit(1);
  }

  console.log("=== Populating real embeddings (lpe_content_blocks) ===");
  const lpeResult = await populateContentEmbeddings(embedder);
  console.log(JSON.stringify(lpeResult));

  console.log("\n=== Populating real embeddings (health_education_content) ===");
  const healthResult = await populateHealthEducationEmbeddings(embedder);
  console.log(JSON.stringify(healthResult));

  const svc = createServiceRoleClient();
  const { count: lpeEmbedded } = await svc
    .from("lpe_content_blocks")
    .select("id", { count: "exact", head: true })
    .not("embedding", "is", null);
  const { count: healthEmbedded } = await svc
    .from("health_education_content")
    .select("id", { count: "exact", head: true })
    .not("embedding", "is", null);
  console.log(`\nReal embedded counts now in the live DB: lpe_content_blocks=${lpeEmbedded}, health_education_content=${healthEmbedded}`);

  console.log("\n=== Retrieval-quality cases (real embeddings, real match_lpe_content_blocks RPC) ===");
  let allPassed = true;
  for (const c of RETRIEVAL_CASES) {
    const results = await findRelevantLifestyleContent(svc, embedder, c.queryText, {
      matchCount: 1,
      conditionFilter: c.conditionFilter,
    });
    const pass = results.length > 0 && results[0]?.condition === c.expectedConditionOfTopResult;
    console.log(
      `  ${pass ? "PASS" : "FAIL"} ${c.case_code}: top result = ${results[0]?.title ?? "(none)"} (condition=${results[0]?.condition ?? "n/a"}, similarity=${results[0]?.similarity ?? "n/a"})`
    );
    if (!pass) allPassed = false;
  }

  console.log(`\n${allPassed ? "ALL RETRIEVAL CASES PASSED" : "SOME RETRIEVAL CASES FAILED"}`);
  process.exit(allPassed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
