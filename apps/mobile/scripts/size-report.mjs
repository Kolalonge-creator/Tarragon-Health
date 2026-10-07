#!/usr/bin/env node
/**
 * Size report (S34, decision OQ-252): records how big the app is. It is a report, never a gate:
 * it always exits 0 so no build fails on size. Run after a build:
 *   node scripts/size-report.mjs path/to/app-release.apk [path/to/app-release.aab ...]
 * With no arguments it reports the JS source and bundled asset footprint, which needs no build.
 * Cold start, installed size on a device and memory are NOT measured here (no device): they stay
 * "not measured" until a device lab run, as in docs/STAGE-1-SIGNOFF.md.
 */
import { readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MB = 1024 * 1024;

function walk(dir, acc = { bytes: 0, files: 0 }) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else {
      acc.bytes += st.size;
      acc.files += 1;
    }
  }
  return acc;
}

const sections = {
  source: walk(join(root, "src")),
  assets: walk(join(root, "assets")),
};
const artefacts = process.argv.slice(2).map((p) => ({ path: p, exists: existsSync(p), bytes: existsSync(p) ? statSync(p).size : 0, kind: extname(p).slice(1) }));

const report = {
  generatedAt: new Date().toISOString(),
  note: "Informational only. Decision OQ-252: size and start time are tracked, never a pass or fail gate.",
  sourceBytes: sections.source.bytes,
  assetBytes: sections.assets.bytes,
  artefacts,
  notMeasured: ["cold start on a device", "installed size on a device", "memory", "logging speed on a device"],
};

mkdirSync(join(root, "build-reports"), { recursive: true });
writeFileSync(join(root, "build-reports", "size-report.json"), JSON.stringify(report, null, 2) + "\n");

const mb = (n) => (n / MB).toFixed(2) + " MB";
console.log(`source ${mb(report.sourceBytes)} (${sections.source.files} files), assets ${mb(report.assetBytes)} (${sections.assets.files} files)`);
for (const a of artefacts) console.log(a.exists ? `${a.path}: ${mb(a.bytes)}` : `${a.path}: not found`);
console.log("Not measured (no device): " + report.notMeasured.join(", "));
process.exit(0);
