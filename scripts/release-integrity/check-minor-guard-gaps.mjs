#!/usr/bin/env node
// Fails when a patient table in PRODUCTION escapes the under-18 dependant scope guard (S04b-1b).
//
// A dependant under 18 may hold immunisation and preventive tracking rows only. Every public table keyed by patient_id must
// be guarded (00_minor_dependant_scope trigger) or listed allowed/exempt in public.minor_dependant_table_policy. CI proves
// this on a fresh replay, but migrations are applied to production separately and can land in a different order, so this
// asks the live database: `select * from private.minor_guard_gaps()` must be empty.
//
// Fix: in a NEW migration call private.guard_minor_dependant_table('<table>') (or insert an allowed/exempt policy row with a
// reason). Runbook: docs/runbooks/minor-guard-gaps.md.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node check-minor-guard-gaps.mjs

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "koiplnmbgnqnbywhpjlf";
const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
const QUERY = "select table_name, problem from private.minor_guard_gaps() order by table_name;";

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 50, ...opts });
}

function shRetry(cmd, args, opts = {}) {
  try {
    return sh(cmd, args, opts);
  } catch (err) {
    console.log(`retrying once after transient failure: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
    return sh(cmd, args, opts);
  }
}

/** The CLI prints either a bare array or {rows: [...]}, sometimes after a status blob: take the first balanced JSON with rows. */
export function parseRows(raw) {
  let i = 0;
  while (i < raw.length) {
    const start = raw.slice(i).search(/[{[]/);
    if (start === -1) break;
    const abs = i + start;
    const open = raw[abs];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let end = -1;
    for (let j = abs; j < raw.length; j++) {
      if (raw[j] === open) depth++;
      else if (raw[j] === close && --depth === 0) {
        end = j;
        break;
      }
    }
    if (end === -1) break;
    try {
      const parsed = JSON.parse(raw.slice(abs, end + 1));
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed?.rows)) return parsed.rows;
    } catch {
      /* try the next structure */
    }
    i = end + 1;
  }
  throw new Error(`no rows array in output:\n${raw}`);
}

/** Pass/fail decision, separate from the database round trip so it can be tested on a synthetic array. */
export function evaluate(rows) {
  return rows.map((r) => `${r.table_name} (${r.problem})`);
}

function main() {
  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    console.error("SUPABASE_ACCESS_TOKEN is not set: cannot check the under-18 scope guard.");
    process.exit(2);
  }
  sh("npx", ["--yes", "supabase", "link", "--project-ref", PROJECT_REF, "--yes", "--workdir", REPO_ROOT]);
  const dir = mkdtempSync(join(tmpdir(), "minor-guard-gaps-"));
  const file = join(dir, "query.sql");
  writeFileSync(file, QUERY);
  let raw;
  try {
    raw = shRetry("npx", ["--yes", "supabase", "db", "query", "--linked", "-f", file, "--output-format", "json"], {
      env: { ...process.env },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const gaps = evaluate(parseRows(raw));
  if (gaps.length === 0) {
    console.log("OK: every patient table is guarded or classified for under-18 dependants.");
    return;
  }
  console.error(`\n${gaps.length} patient table(s) escape the under-18 dependant scope guard in production:`);
  for (const g of gaps) console.error(`  ${g}`);
  console.error("\nFix with a new migration: select private.guard_minor_dependant_table('<table>'); see docs/runbooks/minor-guard-gaps.md");
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
