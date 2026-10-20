#!/usr/bin/env node
// Usage: node scripts/asr-eval/run.mjs <manifest.json> [--json] [--pass-mark 95 | --pass-mark none]
// The pass mark defaults to 95 percent on drug names and on numbers (Q19); see scripts/asr-eval/SCORING.md. Exit: 0 pass or no gate, 1 missing files, 3 FAIL, 4 not enough data.
//
// The manifest lists clips; paths are relative to the manifest:
//   { "clips": [ { "id": "c01", "accent": "yoruba", "reference": "ref/c01.json", "hypothesis": "hyp/c01.json" } ] }
// Each file is a vendor-neutral transcript (see score.mjs). Nothing is sent anywhere and no audio is read or written. Exits 1 when a
// listed file is missing or unreadable, so a half-collected gold set cannot look like a pass.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drugSet, evaluate, renderReport } from "./score.mjs";
import { DEFAULTS, gate, renderGate } from "./gate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error("usage: node scripts/asr-eval/run.mjs <manifest.json> [--json]");
  process.exit(2);
}
const dir = dirname(resolve(manifestPath));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const drugs = drugSet(JSON.parse(readFileSync(resolve(here, "drug-names.json"), "utf8")));
const clips = [];
let missing = 0;
for (const c of manifest.clips ?? []) {
  try {
    clips.push({ id: c.id, accent: c.accent, reference: JSON.parse(readFileSync(resolve(dir, c.reference), "utf8")), hypothesis: JSON.parse(readFileSync(resolve(dir, c.hypothesis), "utf8")) });
  } catch {
    missing += 1;
    console.error(`missing or unreadable files for clip ${c.id}`);
  }
}
const result = evaluate(clips, drugs);
const markArg = process.argv.includes("--pass-mark") ? process.argv[process.argv.indexOf("--pass-mark") + 1] : String(DEFAULTS.passMark * 100);
const verdict = markArg === "none" ? null : gate(result, { passMark: Number(markArg) / 100 });
if (verdict && !(verdict.passMark > 0 && verdict.passMark <= 1)) {
  console.error("--pass-mark must be a percent from 1 to 100, or none");
  process.exit(2);
}
console.log(process.argv.includes("--json") ? JSON.stringify({ ...result, gate: verdict }, null, 2) : `${renderReport(result)}${verdict ? `\n\n${renderGate(verdict)}` : ""}`);
process.exit(missing > 0 ? 1 : verdict?.verdict === "FAIL" ? 3 : verdict?.verdict === "NOT_ENOUGH_DATA" ? 4 : 0);
