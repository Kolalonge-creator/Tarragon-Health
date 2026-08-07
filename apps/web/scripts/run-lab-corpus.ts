/**
 * Run the real extraction engine over a folder of real lab reports and score it.
 *
 *   pnpm --filter @tarragon/web lab-corpus
 *   pnpm --filter @tarragon/web lab-corpus -- --case synlab-fbc-01
 *
 * Requires ANTHROPIC_API_KEY. Every run costs one vision call per case (two if
 * a case exercises the hint retry), so it is a deliberate command rather than
 * part of `pnpm test`.
 *
 * WHAT THIS IS FOR: everything else in lib/lab-reports can be tested without a
 * model. This is the only thing that answers whether the engine actually reads
 * a creased photograph of a Nigerian laboratory report, which is the entire
 * commercial claim. Run it whenever the prompt, the catalogue or the quality
 * control changes — those are exactly the changes that look harmless and move
 * real accuracy.
 *
 * PHI WARNING: real reports carry patient names, addresses and hospital
 * numbers. `lab-corpus/cases/` is gitignored for that reason. De-identify
 * before sharing a case with anyone, and never commit one.
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { extractLabReport } from "../src/lib/lab-reports/extract";
import { normaliseForVision } from "../src/lib/lab-reports/heic";
import {
  aggregate,
  formatReport,
  scoreCase,
  type ExpectedReport,
} from "../src/lib/lab-reports/accuracy";

const CORPUS_DIR = path.join(process.cwd(), "lab-corpus", "cases");

const MEDIA_TYPE: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

async function main() {
  const only = process.argv.includes("--case")
    ? process.argv[process.argv.indexOf("--case") + 1]
    : null;

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. This script calls the real model.");
    process.exit(1);
  }
  if (!existsSync(CORPUS_DIR)) {
    console.error(
      `No corpus at ${CORPUS_DIR}.\n` +
        "Add a case: a folder containing the report file and an expected.json.\n" +
        "See lab-corpus/README.md.",
    );
    process.exit(1);
  }

  const dirs = (await readdir(CORPUS_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => !only || name === only)
    .sort();

  if (dirs.length === 0) {
    console.error(only ? `No case named "${only}".` : "The corpus is empty.");
    process.exit(1);
  }

  const scored = [];
  for (const caseId of dirs) {
    const dir = path.join(CORPUS_DIR, caseId);
    const files = await readdir(dir);

    const expectedFile = files.find((f) => f === "expected.json");
    if (!expectedFile) {
      console.warn(`  ${caseId}: no expected.json, skipped`);
      continue;
    }
    const documentFile = files.find((f) => MEDIA_TYPE[path.extname(f).toLowerCase()]);
    if (!documentFile) {
      console.warn(`  ${caseId}: no readable document, skipped`);
      continue;
    }

    const expected = JSON.parse(
      await readFile(path.join(dir, expectedFile), "utf8"),
    ) as ExpectedReport;

    // Same normalisation the real upload path applies, so a HEIC case in the
    // corpus exercises the same code an iPhone upload does.
    const raw = await readFile(path.join(dir, documentFile));
    const normalised = await normaliseForVision(
      raw,
      MEDIA_TYPE[path.extname(documentFile).toLowerCase()]!,
    );

    process.stdout.write(`  ${caseId} ... `);
    const result = await extractLabReport({
      fileBase64: normalised.buffer.toString("base64"),
      mediaType: normalised.mediaType,
    });

    if (!result.ok) {
      console.log(`FAILED (${result.reason})`);
      // A failed extraction is scored as everything missed, not skipped —
      // otherwise a model outage would flatter the numbers.
      scored.push(scoreCase(caseId, expected, []));
      continue;
    }

    if (process.argv.includes("--verbose")) {
      console.log("");
      for (const r of result.extraction.rows) {
        console.log(
          `      "${r.reportedLabel}" -> ${r.code ?? "(unmapped)"} = ` +
            `${r.value ?? r.valueText ?? "-"} ${r.unit ?? ""} [${r.status}]`,
        );
      }
    }

    const score = scoreCase(caseId, expected, result.extraction.rows);
    const c = score.counts;
    console.log(
      `ok ${c.correct}  wrong ${c.wrong}  held ${c.blocked}  missed ${c.missed}  spurious ${c.spurious}`,
    );
    scored.push(score);
  }

  const report = aggregate(scored);
  console.log("");
  console.log(formatReport(report));

  // Any harmful reading fails the run. This is the line that makes the harness
  // a gate rather than a dashboard: a wrong or invented value is the one thing
  // this engine must not produce.
  if (report.totals.wrong + report.totals.spurious > 0) {
    console.error("\nFAIL: harmful readings present.");
    process.exit(1);
  }
  console.log("\nPASS: no harmful readings.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
