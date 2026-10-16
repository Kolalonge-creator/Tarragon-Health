#!/usr/bin/env node
// Usage: node scripts/asr-eval/run.mjs <manifest.json> [--json]
//
// The manifest lists clips; paths are relative to the manifest:
//   { "clips": [ { "id": "c01", "accent": "yoruba", "reference": "ref/c01.json", "hypothesis": "hyp/c01.json" } ] }
// Each file is a vendor-neutral transcript (see score.mjs). Nothing is sent anywhere and no audio is read or written. Exits 1 when a
// listed file is missing or unreadable, so a half-collected gold set cannot look like a pass.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drugSet, evaluate, renderReport } from "./score.mjs";

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
console.log(process.argv.includes("--json") ? JSON.stringify(result, null, 2) : renderReport(result));
process.exit(missing > 0 ? 1 : 0);
