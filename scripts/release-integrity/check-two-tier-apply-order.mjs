#!/usr/bin/env node
// Prints the migrations that are NOT yet live, in apply order, and fails if any of them sorts before the newest live version.
//
// Why: the two-tier integration migrations carry hand-spaced future stamps. They must be applied one at a time, in file order, with the
// supabase_migrations.schema_migrations version pinned to the filename (CLAUDE.md). If anything newer than the first of them is
// already live (another session applied a migration in the meantime), a plain apply would put a migration BEFORE the live head;
// this check stops that so you re-stamp from the clock first.
//
// Usage:
//   node scripts/release-integrity/check-two-tier-apply-order.mjs --live live-versions.txt [--dir supabase/migrations] [--since 20261013000000]
// The live list is a file: one version per line, or the JSON array printed by list_migrations / execute_sql
// (strings, or objects with a "version" field). Exit 0 = safe to apply in the printed order; exit 1 = re-stamp needed (reasons printed).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export function parseLive(text) {
  const t = text.trim();
  if (t.startsWith("[") || t.startsWith("{")) {
    let data = JSON.parse(t);
    if (!Array.isArray(data)) data = data.result ?? data.migrations ?? [];
    return data.map((x) => String(typeof x === "string" ? x : x.version));
  }
  return t.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^\d{14}/.test(l)).map((l) => l.slice(0, 14));
}

export function checkApplyOrder(localFiles, liveVersions, since = "0") {
  const live = new Set(liveVersions);
  const newestLive = [...live].sort().at(-1) ?? "0";
  const files = localFiles.filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
  const versions = files.map((f) => f.slice(0, 14));
  const problems = [];
  const dupes = versions.filter((v, i) => versions.indexOf(v) !== i);
  if (dupes.length) problems.push(`duplicate versions in the repository: ${[...new Set(dupes)].join(", ")}`);
  const toApply = files.filter((f) => !live.has(f.slice(0, 14)) && f.slice(0, 14) >= since);
  for (const f of toApply) {
    if (f.slice(0, 14) < newestLive) {
      problems.push(`${f} sorts before the newest live version ${newestLive}; re-stamp it (and everything after it) from the clock before applying`);
    }
  }
  return { newestLive, toApply, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const liveFile = arg("--live");
  if (!liveFile) {
    console.error("usage: check-two-tier-apply-order.mjs --live <file of live versions> [--dir supabase/migrations] [--since 14-digit version]");
    process.exit(2);
  }
  const dir = arg("--dir", "supabase/migrations");
  const since = arg("--since", "0");
  const { newestLive, toApply, problems } = checkApplyOrder(readdirSync(dir), parseLive(readFileSync(liveFile, "utf8")), since);
  console.log(`newest live version: ${newestLive}`);
  console.log(`${toApply.length} migration(s) not live, in apply order (apply one at a time, version pinned to the filename):`);
  toApply.forEach((f, i) => console.log(`${String(i + 1).padStart(3)}. ${join(dir, f)}`));
  if (problems.length) {
    console.error("\nNOT SAFE TO APPLY:");
    problems.forEach((p) => console.error(` - ${p}`));
    process.exit(1);
  }
  console.log("\nOK: every migration to apply sorts after the newest live version.");
}
