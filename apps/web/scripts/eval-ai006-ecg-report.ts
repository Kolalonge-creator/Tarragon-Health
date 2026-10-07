/**
 * AI-006 (ECG report extraction) golden-image eval.
 * Run: pnpm --filter @tarragon/web ai006-eval
 *
 * Real claude-sonnet-5 VISION calls through the real extractEcgReport(),
 * against real PNG images (headless-Chrome-rendered, known-ground-truth
 * fixtures). Same transcription-only discipline as AI-005: exact-match
 * scoring against a hand-verified answer key, no LLM judge.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractEcgReport } from "../src/lib/ecg-reports/extract";
import type { CaseRunResult } from "./lib/scope-guardrail-judge";
import { printAndSummarise } from "./lib/scope-guardrail-judge";

const FIXTURES_DIR = join(__dirname, "fixtures");

async function main() {
  const results: CaseRunResult[] = [];

  // Case 1: a clean, self-consistent 12-lead printout -- known answer key.
  {
    const imageBase64 = readFileSync(join(FIXTURES_DIR, "ecg-report-clean.png")).toString("base64");
    const result = await extractEcgReport({ fileBase64: imageBase64, mediaType: "image/png" });

    if (!result.ok) {
      results.push({ case_code: "clean_twelve_lead_panel", outcome: "fail", actual_output: `FAILED: ${result.reason}` });
    } else {
      const byLabel = new Map(result.extraction.parameters.map((p) => [p.reportedLabel.toLowerCase(), p]));
      const checks: { desc: string; pass: boolean }[] = [];

      checks.push({ desc: "looks_twelve_lead = true (12 lead labels visible)", pass: result.extraction.looksTwelveLead === true });

      const hr = byLabel.get("heart rate");
      checks.push({ desc: "heart rate = 60", pass: hr?.value === 60 });

      const pr = byLabel.get("pr interval");
      checks.push({ desc: "PR interval = 160", pass: pr?.value === 160 });

      const qrs = byLabel.get("qrs duration");
      checks.push({ desc: "QRS duration = 90", pass: qrs?.value === 90 });

      const qt = byLabel.get("qt interval");
      checks.push({ desc: "QT interval = 400", pass: qt?.value === 400 });

      const qtc = byLabel.get("qtc (bazett)");
      checks.push({ desc: "QTc = 400 (matches QT here, self-consistent at HR 60)", pass: qtc?.value === 400 });

      const rhythmRow = result.extraction.parameters.find((p) => p.code === "machine_rhythm_statement");
      checks.push({
        desc: "machine rhythm statement transcribed verbatim ('Normal sinus rhythm'), never itself classified/reinterpreted",
        pass: (rhythmRow?.valueText ?? "").toLowerCase().includes("normal sinus rhythm"),
      });

      const allPass = checks.every((c) => c.pass);
      console.log(`  ${allPass ? "PASS" : "FAIL"} clean_twelve_lead_panel:`);
      for (const c of checks) console.log(`    ${c.pass ? "OK" : "MISS"} ${c.desc}`);
      results.push({
        case_code: "clean_twelve_lead_panel",
        outcome: allPass ? "pass" : "fail",
        actual_output: `looksTwelveLead=${result.extraction.looksTwelveLead} | parameters=${JSON.stringify(result.extraction.parameters)}`,
      });
    }
  }

  // Case 2: a single-lead rhythm strip, NOT a 12-lead recording -- must set
  // looks_twelve_lead=false, never fabricate a full 12-lead parameter block.
  {
    const imageBase64 = readFileSync(join(FIXTURES_DIR, "ecg-single-rhythm-strip.png")).toString("base64");
    const result = await extractEcgReport({ fileBase64: imageBase64, mediaType: "image/png" });

    if (!result.ok) {
      results.push({ case_code: "single_lead_strip_not_twelve_lead", outcome: "fail", actual_output: `FAILED: ${result.reason}` });
    } else {
      const pass = result.extraction.looksTwelveLead === false;
      console.log(
        `  ${pass ? "PASS" : "FAIL"} single_lead_strip_not_twelve_lead: looksTwelveLead=${result.extraction.looksTwelveLead}, parameters=${result.extraction.parameters.length}`
      );
      results.push({
        case_code: "single_lead_strip_not_twelve_lead",
        outcome: pass ? "pass" : "fail",
        actual_output: `looksTwelveLead=${result.extraction.looksTwelveLead} | parameters=${JSON.stringify(result.extraction.parameters)}`,
      });
    }
  }

  printAndSummarise(results);
  writeFileSync("/tmp/ai006-eval-result.json", JSON.stringify(results, null, 2));
  console.log("\nWrote /tmp/ai006-eval-result.json");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
