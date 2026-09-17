/**
 * AI-005 (Lab report extraction) golden-image eval.
 * Run: pnpm --filter @tarragon/web ai005-eval
 *
 * Real claude-sonnet-5 VISION calls through the real extractLabReport(),
 * against real PNG images (rendered via headless Chrome from controlled,
 * known-ground-truth HTML fixtures -- scripts/fixtures/render.sh). This is
 * a transcription/correctness task with a real answer key, scored by
 * exact-match against it, per docs/AI_002_015_EVALUATION_SCOPE.md's AI-005
 * section -- not an LLM judge.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractLabReport } from "../src/lib/lab-reports/extract";
import type { CaseRunResult } from "./lib/scope-guardrail-judge";
import { printAndSummarise } from "./lib/scope-guardrail-judge";

const FIXTURES_DIR = join(__dirname, "fixtures");

async function main() {
  const results: CaseRunResult[] = [];

  // Case 1: general chemistry panel + a qualitative row (genotype) + one
  // value deliberately outside its own printed reference range (LDL 6.9,
  // printed range "< 3.4") -- real answer key below, hand-verified against
  // the fixture HTML.
  {
    const imageBase64 = readFileSync(join(FIXTURES_DIR, "lab-report-general.png")).toString("base64");
    const result = await extractLabReport({ fileBase64: imageBase64, mediaType: "image/png" });

    if (!result.ok) {
      results.push({ case_code: "general_panel_with_genotype_and_range_flag", outcome: "fail", actual_output: `FAILED: ${result.reason}` });
    } else {
      const rowsByLabel = new Map(result.extraction.rows.map((r) => [r.reportedLabel.toLowerCase(), r]));
      const checks: { desc: string; pass: boolean }[] = [];
      // ExtractedRow.value is in the analyte's CANONICAL unit once
      // validateExtractedRow has converted it (real, correct, standard
      // clinical conversion factors) -- these expected values are the
      // hand-verified real conversions of the printed mmol/L or umol/L
      // figures into the catalogue's canonical mg/dL, not the raw printed
      // numbers. A close() check absorbs float rounding, nothing more.
      const close = (a: number | null | undefined, b: number, tol: number) =>
        typeof a === "number" && Math.abs(a - b) <= tol;

      const glucose = rowsByLabel.get("fasting blood glucose");
      checks.push({ desc: "glucose 5.2 mmol/L -> ~93.68 mg/dL (real conversion factor)", pass: close(glucose?.value, 93.68, 0.5) });
      checks.push({ desc: "glucose status=ready", pass: glucose?.status === "ready" });

      const ldl = rowsByLabel.get("ldl cholesterol");
      checks.push({ desc: "LDL 6.9 mmol/L -> ~266.8 mg/dL (real conversion factor, not corrected toward the range)", pass: close(ldl?.value, 266.8, 2) });
      checks.push({
        desc: "LDL flagged as outside its own printed range (implausible status OR a QC flag present)",
        pass: ldl?.status === "implausible" || (ldl?.flags.length ?? 0) > 0,
      });

      const genotype = rowsByLabel.get("haemoglobin genotype");
      checks.push({ desc: "genotype transcribed as a row at all (not silently skipped)", pass: Boolean(genotype) });
      checks.push({ desc: "genotype value_text='AS' (verbatim qualitative result)", pass: genotype?.valueText === "AS" });

      const creatinine = rowsByLabel.get("serum creatinine");
      checks.push({ desc: "creatinine 78 umol/L -> ~0.882 mg/dL (real conversion factor)", pass: close(creatinine?.value, 0.882, 0.02) });

      const allPass = checks.every((c) => c.pass);
      console.log(`  ${allPass ? "PASS" : "FAIL"} general_panel_with_genotype_and_range_flag:`);
      for (const c of checks) console.log(`    ${c.pass ? "OK" : "MISS"} ${c.desc}`);
      results.push({
        case_code: "general_panel_with_genotype_and_range_flag",
        outcome: allPass ? "pass" : "fail",
        actual_output: `rows=${JSON.stringify(result.extraction.rows)} | checks=${JSON.stringify(checks)}`,
      });
    }
  }

  // Case 2: not a lab report at all -- must set unreadable_reason, never
  // fabricate lab rows from an unrelated document.
  {
    const imageBase64 = readFileSync(join(FIXTURES_DIR, "not-a-lab-report.png")).toString("base64");
    const result = await extractLabReport({ fileBase64: imageBase64, mediaType: "image/png" });

    if (!result.ok) {
      results.push({ case_code: "not_a_lab_report_sets_unreadable_reason", outcome: "fail", actual_output: `FAILED: ${result.reason}` });
    } else {
      const pass = Boolean(result.extraction.unreadableReason) && result.extraction.rows.length === 0;
      console.log(
        `  ${pass ? "PASS" : "FAIL"} not_a_lab_report_sets_unreadable_reason: unreadable_reason="${result.extraction.unreadableReason}", rows=${result.extraction.rows.length}`
      );
      results.push({
        case_code: "not_a_lab_report_sets_unreadable_reason",
        outcome: pass ? "pass" : "fail",
        actual_output: `unreadableReason=${JSON.stringify(result.extraction.unreadableReason)} rows=${JSON.stringify(result.extraction.rows)}`,
      });
    }
  }

  printAndSummarise(results);
  writeFileSync("/tmp/ai005-eval-result.json", JSON.stringify(results, null, 2));
  console.log("\nWrote /tmp/ai005-eval-result.json");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
