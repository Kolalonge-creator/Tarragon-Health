#!/usr/bin/env node
// Automates the manual audit CLAUDE.md's memory notes describe running by hand every few days.
// Rewritten 2026-09-03 (full-platform audit) for three reasons, each of which had made the job
// permanently red or unable to run at all — a permanently red check is one nobody reads:
//
//   1. CONNECTION: `supabase migration list --linked` opens a direct DB connection, which on a
//      GitHub runner fails with `password authentication failed for user "cli_login_postgres"`
//      unless a SUPABASE_DB_PASSWORD secret exists (it never did — the job had 0 successful runs
//      ever). `supabase db query --linked` authenticates via SUPABASE_ACCESS_TOKEN through the
//      management API instead — proven working in CI by check-anon-security-definer-execute.mjs
//      every run. So this script now reads supabase_migrations.schema_migrations itself.
//
//   2. RE-STAMPED VERSIONS: migrations applied via the MCP `apply_migration` tool get a live
//      `version` from wall-clock time regardless of the local filename (CLAUDE.md's 2026-08-29
//      lesson). Several live rows carry the ORIGINAL filename in `name` (e.g. version
//      20260903005735, name "20260828234002_analytics_care_engagement_summary") — the content of
//      the local 20260828234002_*.sql file IS applied, just under a different version. A naive
//      exact-version diff reports those forever as both "local never applied" and "remote with no
//      file". This script matches a live row to a local file by version OR by the 14-digit
//      timestamp embedded at the front of its `name`.
//
//   3. SEVERITY: ~27 open PRs apply their migrations to the one live project by design here, so
//      "remote has migrations main-dev doesn't" is the normal working state, not a release
//      defect. Failing on it made red meaningless. The check now FAILS only on true loss/ship
//      risk — a live migration traceable to NO commit anywhere (unrecoverable if the session's
//      disk dies), a live migration committed only on an unpushed/local branch, or a migration
//      committed on THIS ref but never applied live — and prints branch-owned drift as a
//      warning inventory instead.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node check-migration-drift.mjs
// Exits non-zero on any FAIL-class finding above.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "koiplnmbgnqnbywhpjlf";
const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 50, ...opts });
}

// `supabase db query --linked` occasionally dies after printing only "Initialising login
// role..." (transient management-API/CLI flake — see check-anon-security-definer-execute.mjs).
function shRetry(cmd, args, opts = {}) {
  try {
    return sh(cmd, args, opts);
  } catch (err) {
    console.log(`retrying once after transient failure: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
    return sh(cmd, args, opts);
  }
}

// Same output-shape-tolerant parser as check-anon-security-definer-execute.mjs — `supabase db
// query --output-format json` has emitted both a bare rows array and a {rows} wrapper for the
// same CLI version tag, sometimes preceded by a status blob. Scan balanced structures and take
// the first that is an array or carries a `.rows` array.
function parseRows(raw) {
  const candidates = [];
  let i = 0;
  while (i < raw.length) {
    const start = raw.slice(i).search(/[{[]/);
    if (start === -1) break;
    const absStart = i + start;
    const open = raw[absStart];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let end = -1;
    for (let j = absStart; j < raw.length; j++) {
      if (raw[j] === open) depth++;
      else if (raw[j] === close) {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) break;
    candidates.push(raw.slice(absStart, end + 1));
    i = end + 1;
  }
  for (const text of candidates) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.rows)) return parsed.rows;
  }
  console.error(`Could not find a rows array in \`supabase db query\` output:\n${raw}`);
  process.exit(2);
}

function findOwningBranch(version, name) {
  // Which commit (if any) first added this migration file, and which remote branches contain it.
  // Probe by version first; when the apply was re-stamped (MCP apply_migration assigns a live
  // version from wall-clock seconds after the file was named), the only stable identifier is the
  // migration NAME, so fall back to any file ending in `_<name>.sql` under any timestamp.
  let commit;
  try {
    commit = sh("git", [
      "-C", REPO_ROOT, "log", "--all", "--format=%H", "--diff-filter=A",
      "--", `supabase/migrations/${version}_*.sql`,
    ]).trim().split("\n")[0];
  } catch {
    commit = "";
  }
  if (!commit && name && /^[A-Za-z0-9_]+$/.test(name)) {
    try {
      commit = sh("git", [
        "-C", REPO_ROOT, "log", "--all", "--format=%H", "--diff-filter=A",
        "--", `supabase/migrations/*_${name}.sql`,
      ]).trim().split("\n")[0];
    } catch {
      commit = "";
    }
  }
  if (!commit) return { commit: null, branches: [] };

  let branches = [];
  try {
    branches = sh("git", ["-C", REPO_ROOT, "branch", "-r", "--contains", commit])
      .split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    branches = [];
  }
  return { commit, branches };
}

// A live row is identified by its `version`, but may ALSO correspond to a local file whose
// timestamp survives at the front of `name` (re-stamped apply — see header note 2).
function nameEmbeddedVersion(name) {
  const m = /^(\d{14})_/.exec(name || "");
  return m ? m[1] : null;
}

export function evaluate(remoteRows, localFiles) {
  // localFiles: array of migration filenames (e.g. "20260902224824_menstrual_bbt.sql").
  const byVersion = new Map();
  const byName = new Map();
  for (const f of localFiles) {
    const m = /^(\d{14})_(.*)\.sql$/.exec(f);
    if (!m) continue;
    byVersion.set(m[1], m[1]);
    // Last-wins on duplicate names is fine: any match means the content exists in this tree.
    byName.set(m[2], m[1]);
  }

  const matchedLocal = new Set();
  const remoteOnly = [];

  for (const row of remoteRows) {
    const nv = nameEmbeddedVersion(row.name);
    if (byVersion.has(row.version)) matchedLocal.add(row.version);
    else if (nv && byVersion.has(nv)) matchedLocal.add(nv);
    else if (row.name && byName.has(row.name)) matchedLocal.add(byName.get(row.name));
    else remoteOnly.push(row);
  }

  const localOnly = [...byVersion.keys()].filter((v) => !matchedLocal.has(v));
  return { remoteOnly, localOnly };
}

function main() {
  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    console.error("SUPABASE_ACCESS_TOKEN is not set — cannot check migration drift.");
    process.exit(2);
  }

  // `link` (not a hand-written project-ref file) so the CLI resolves the IPv4-compatible pooler
  // and management-API paths — same rationale and fix as the other release-integrity scripts.
  sh("npx", ["--yes", "supabase", "link", "--project-ref", PROJECT_REF, "--yes", "--workdir", REPO_ROOT]);

  console.log(`Comparing local migrations against what's applied on project ${PROJECT_REF}...`);

  const queryDir = mkdtempSync(join(tmpdir(), "migration-drift-check-"));
  const queryFile = join(queryDir, "query.sql");
  writeFileSync(queryFile, "select version, name from supabase_migrations.schema_migrations order by version;");
  let remoteRows;
  try {
    const raw = shRetry("npx", ["--yes", "supabase", "db", "query", "--linked", "-f", queryFile, "--output-format", "json"]);
    remoteRows = parseRows(raw);
  } finally {
    rmSync(queryDir, { recursive: true, force: true });
  }

  const localFiles = readdirSync(join(REPO_ROOT, "supabase", "migrations"))
    .filter((f) => /^\d{14}_.*\.sql$/.test(f));

  const { remoteOnly, localOnly } = evaluate(remoteRows, localFiles);

  if (remoteOnly.length === 0 && localOnly.length === 0) {
    console.log(`OK: ${remoteRows.length} applied migrations all reconcile against ${localVersions.length} local files.`);
    return;
  }

  const failures = [];
  const warnings = [];

  if (localOnly.length > 0) {
    // Committed on THIS ref (the release branch) but never applied live: the app code being
    // released depends on schema that does not exist. Always a failure.
    for (const v of localOnly) failures.push(`LOCAL-NOT-APPLIED: ${v}_*.sql is committed here but has never been applied to the live project.`);
  }

  for (const row of remoteOnly) {
    const probeVersion = nameEmbeddedVersion(row.name) || row.version;
    const { commit, branches } = findOwningBranch(probeVersion);
    const label = `${row.version} (${row.name})`;
    if (!commit) {
      failures.push(
        `UNTRACED: ${label} is applied live but found in NO commit anywhere. Recover it now — ` +
          `supabase_migrations.schema_migrations.statements still holds the applied SQL; commit it before it is only in the database.`,
      );
    } else if (branches.length === 0) {
      failures.push(`UNPUSHED: ${label} is committed at ${commit.slice(0, 12)} but on no remote branch — it exists on one disk only. Push that branch.`);
    } else {
      warnings.push(`branch-owned: ${label} — on ${branches.slice(0, 3).join(", ")}${branches.length > 3 ? ` (+${branches.length - 3} more)` : ""}, not merged into main-dev yet.`);
    }
  }

  if (warnings.length > 0) {
    console.log(`\n${warnings.length} live migration(s) belong to unmerged-but-pushed branches (normal here — many PRs apply to the one live project). Inventory:`);
    for (const w of warnings) console.log(`  WARN ${w}`);
  }

  if (failures.length === 0) {
    console.log(`\nOK: no loss-risk drift. (${warnings.length} branch-owned migrations awaiting merge, listed above.)`);
    return;
  }

  console.error(`\n${failures.length} loss-risk drift finding(s):`);
  for (const f of failures) console.error(`  FAIL ${f}`);
  console.error(
    `\nUNTRACED means the SQL exists only in the production database; UNPUSHED means it exists on one ` +
      `machine; LOCAL-NOT-APPLIED means this ref ships code against schema that is not live. Fix by ` +
      `committing/pushing the owning work or applying the missing migration — never by editing history.`,
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
