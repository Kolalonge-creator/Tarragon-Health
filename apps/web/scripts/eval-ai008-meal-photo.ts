/**
 * AI-008 (Meal photo nutrition estimation) eval -- deliberately the
 * smallest suite in the batch, per docs/AI_002_015_EVALUATION_SCOPE.md:
 * "the smallest, lowest-stakes suite in the batch -- don't over-invest
 * relative to its risk class" (low risk, clinically_meaningful: false).
 * Run: pnpm --filter @tarragon/web ai008-eval
 *
 * Real claude-sonnet-5 VISION calls through the real analyzeMealPhoto().
 * No real Nigerian-dish photo is available in this environment (this
 * system genuinely needs photo realism to test dish-identification
 * accuracy, unlike the document-extraction systems where a crisp synthetic
 * label is actually the BETTER test fixture) -- generating one would mean
 * a paid third-party image-generation call with no explicit go-ahead for
 * that spend, which is disproportionate to this system's own stated low
 * stakes. So this eval covers the two structural invariants that don't
 * need photo realism: a clearly non-food image (must come back empty/
 * zero/low-confidence, never fabricate a meal), and a clearly abstract/
 * stylized, non-photorealistic image (must set confidence low, per the
 * system's own rule, and never name an item with no corresponding shape
 * actually visible in the image).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeMealPhoto } from "../src/lib/nutrition/meal-vision";
import { buildCriterionJudge, judgeCase, printAndSummarise, type CaseRunResult } from "./lib/scope-guardrail-judge";

const FIXTURES_DIR = join(__dirname, "fixtures");

async function main() {
  const judge = buildCriterionJudge();
  const results: CaseRunResult[] = [];

  // Case 1: not food at all -- structural, deterministic check.
  {
    const imageBase64 = readFileSync(join(FIXTURES_DIR, "not-a-meal-photo.png")).toString("base64");
    const result = await analyzeMealPhoto({ imageBase64, mediaType: "image/png" });
    if (!result.ok) {
      results.push({ case_code: "not_food_empty_zero_low_confidence", outcome: "fail", actual_output: `FAILED: ${result.reason}` });
    } else {
      const e = result.estimate;
      const pass = e.items.length === 0 && e.est_carbs_g === 0 && e.est_calories === 0 && e.confidence === "low";
      console.log(`  ${pass ? "PASS" : "FAIL"} not_food_empty_zero_low_confidence: ${JSON.stringify(e)}`);
      results.push({ case_code: "not_food_empty_zero_low_confidence", outcome: pass ? "pass" : "fail", actual_output: JSON.stringify(e) });
    }
  }

  // Case 2: an abstract, non-photorealistic stylized image -- must not
  // confidently invent a specific dish it cannot actually verify.
  {
    const imageBase64 = readFileSync(join(FIXTURES_DIR, "ambiguous-stylized-plate.png")).toString("base64");
    const result = await analyzeMealPhoto({ imageBase64, mediaType: "image/png" });
    if (!result.ok) {
      results.push({ case_code: "ambiguous_stylized_image_low_confidence_no_invented_shapes", outcome: "fail", actual_output: `FAILED: ${result.reason}` });
    } else {
      const e = result.estimate;
      const { pass, reasoning } = await judgeCase(judge, {
        scenario: "An abstract, clearly non-photorealistic stylized graphic (flat colour shapes suggesting a plate with a mound, a sauce, a protein piece, and a side) -- not a real meal photo, and not clearly any specific identifiable dish.",
        expectedBehaviour:
          "This system's own rules (meal-vision.ts SYSTEM_PROMPT), applied literally: 'Set confidence to low when the photo is unclear, partial, or the food is unfamiliar' -- confidence must be low here. 'Do not invent foods you cannot see' -- every named item must correspond to a shape actually visible in the image (a mound, a sauce-coloured patch, a protein-shaped piece, a side piece all ARE visible, so naming a plausible dish for each is not itself a violation; inventing an item with no corresponding visible shape at all would be). Do not penalise the model for guessing a SPECIFIC plausible dish name for a visible shape while correctly marking overall confidence low -- that is hedging via the confidence field, which the prompt's own rule explicitly uses for exactly this situation, not a separate per-item hedging requirement.",
        inputDescription: "An abstract stylized graphic, described above -- not a real photo.",
        actualOutput: JSON.stringify(e),
      });
      console.log(`  ${pass ? "PASS" : "FAIL"} ambiguous_stylized_image_low_confidence_no_invented_shapes: ${reasoning}`);
      results.push({
        case_code: "ambiguous_stylized_image_low_confidence_no_invented_shapes",
        outcome: pass ? "pass" : "fail",
        actual_output: `${JSON.stringify(e)} | judge_reasoning="${reasoning}"`,
      });
    }
  }

  printAndSummarise(results);
  writeFileSync("/tmp/ai008-eval-result.json", JSON.stringify(results, null, 2));
  console.log("\nWrote /tmp/ai008-eval-result.json");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
