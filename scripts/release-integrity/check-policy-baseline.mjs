#!/usr/bin/env node
// W-36 (b): nightly snapshot of pg_policies compared with docs/security/pg-policies-baseline.json.
// A policy is identified by schema.table.name and fingerprinted by its command, roles and md5 of its expressions.
//
// Modes:
//   (default)  diff live against the committed baseline. Prints added / removed / changed policies.
//              Exits 1 only when the baseline has "enforce": true. Otherwise report only, exit 0.
//   --write    write the current live snapshot to the baseline file (keeping an existing "enforce" value; a new baseline starts at false). A human reviews and commits it.
//   --out FILE also write the current snapshot to FILE (the nightly job uploads it as an artifact).
//
// The baseline is empty until someone runs --write: nothing here pretends a baseline exists.
// Usage: SUPABASE_ACCESS_TOKEN=... node check-policy-baseline.mjs [--write] [--out file]

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execWithRetry } from "./retry-sync.mjs";
import { parseRows } from "./check-minor-guard-gaps.mjs";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "koiplnmbgnqnbywhpjlf";
const BASELINE = "docs/security/pg-policies-baseline.json";

export const QUERY = `
select schemaname || '.' || tablename || '.' || policyname as id,
       cmd, array_to_string(roles, ',') as roles,
       md5(coalesce(qual, '')) as qual_md5, md5(coalesce(with_check, '')) as check_md5
  from pg_policies
 where schemaname in ('public', 'private', 'analytics', 'storage')
 order by 1;
`;

const fp = (r) => `${r.cmd}|${r.roles}|${r.qual_md5}|${r.check_md5}`;

/** live, baseline: arrays of rows. */
export function diff(live, base) {
  const b = new Map(base.map((r) => [r.id, fp(r)]));
  const l = new Map(live.map((r) => [r.id, fp(r)]));
  return {
    added: [...l.keys()].filter((k) => !b.has(k)),
    removed: [...b.keys()].filter((k) => !l.has(k)),
    changed: [...l.keys()].filter((k) => b.has(k) && b.get(k) !== l.get(k)),
  };
}

/** The snapshot to write. An existing baseline's `enforce` value is kept: refreshing the policies must not silently switch enforcement off. */
export function buildSnapshot(live, existing, generated) {
  return JSON.stringify({ enforce: existing?.enforce === true, generated, policies: live }) + "\n";
}

function readExisting(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function main() {
  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    console.error("SUPABASE_ACCESS_TOKEN is not set: cannot read pg_policies.");
    process.exit(2);
  }
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
  execWithRetry("npx", ["--yes", "supabase", "link", "--project-ref", PROJECT_REF, "--yes", "--workdir", root]);
  const dir = mkdtempSync(join(tmpdir(), "policy-baseline-"));
  const file = join(dir, "query.sql");
  writeFileSync(file, QUERY);
  let live;
  try {
    live = parseRows(execWithRetry("npx", ["--yes", "supabase", "db", "query", "--linked", "-f", file, "--output-format", "json"], { env: { ...process.env } }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const args = process.argv.slice(2);
  const path = join(root, BASELINE);
  const snapshot = buildSnapshot(live, readExisting(path), new Date().toISOString().slice(0, 10));
  const out = args.indexOf("--out");
  if (out !== -1) writeFileSync(args[out + 1], snapshot);
  if (args.includes("--write")) {
    writeFileSync(path, snapshot);
    console.log(`Wrote ${live.length} policies to ${BASELINE}.`);
    return;
  }
  if (!existsSync(path)) {
    console.log(`No ${BASELINE} yet (${live.length} live policies). Run with --write, review, and commit it to start enforcing.`);
    return;
  }
  const base = JSON.parse(readFileSync(path, "utf8"));
  const d = diff(live, base.policies ?? []);
  const total = d.added.length + d.removed.length + d.changed.length;
  console.log(`Policies live ${live.length}, baseline ${(base.policies ?? []).length}: ${d.added.length} added, ${d.removed.length} removed, ${d.changed.length} changed.`);
  for (const [label, ids] of Object.entries(d)) for (const id of ids.slice(0, 200)) console.log(`  ${label}: ${id}`);
  if (total > 0 && base.enforce === true) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
