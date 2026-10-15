#!/usr/bin/env node
// Applies the migration files a push to main-dev ADDED to the live project, in version order, each one pinned to its own filename
// version (so supabase_migrations.schema_migrations matches git, unlike the MCP apply_migration which stamps wall-clock time).
//
// Safety rules, all fail-closed:
//   - only files ADDED in the pushed range are considered (never an edited or deleted file);
//   - a migration already in schema_migrations (same version OR same name) is skipped, never re-run;
//   - each file runs inside one transaction together with its schema_migrations row, so a failure leaves the database as it was;
//   - the first failure stops the run (later files may depend on it) and the job fails, which GitHub reports to the committer;
//   - --list prints what would be applied and touches nothing (also what a missing SUPABASE_ACCESS_TOKEN falls back to).
// CI replay (a required check on every PR) has already proven the file applies on a fresh database; this only mirrors it to live.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node apply-new-migrations.mjs <base-sha> <head-sha> [--list]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { execWithRetry, isLoginRoleFailure } from "./retry-sync.mjs";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "koiplnmbgnqnbywhpjlf";
const [base, head, ...flags] = process.argv.slice(2);
const listOnly = flags.includes("--list");

if (!base || !head) {
  console.error("usage: apply-new-migrations.mjs <base-sha> <head-sha> [--list]");
  process.exit(2);
}

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 50 });
}

// An all-zero base (first push of a branch) means there is no range to compare: apply nothing rather than guess.
if (/^0+$/.test(base)) {
  console.log("no base commit to compare against; nothing to apply.");
  process.exit(0);
}

const added = sh("git", ["diff", "--diff-filter=A", "--name-only", base, head, "--", "supabase/migrations"])
  .split("\n")
  .filter((f) => /^supabase\/migrations\/\d{14}_[A-Za-z0-9_]+\.sql$/.test(f))
  .sort();

if (added.length === 0) {
  console.log("no new migration files in this push.");
  process.exit(0);
}

console.log(`new migration files (${added.length}):`);
for (const f of added) console.log(`  ${f}`);

if (listOnly || !process.env.SUPABASE_ACCESS_TOKEN) {
  console.log(listOnly ? "--list: nothing applied." : "SUPABASE_ACCESS_TOKEN is not set: nothing applied.");
  process.exit(listOnly ? 0 : 1);
}

function query(sqlText) {
  const dir = mkdtempSync(join(tmpdir(), "mig-"));
  const file = join(dir, "q.sql");
  writeFileSync(file, sqlText);
  const args = ["supabase", "db", "query", "--linked", "--project-ref", PROJECT_REF, "-f", file, "--output-format", "json"];
  // The CLI creates a login role per call and can fail to ("Failed to create login role", status 544) before any SQL is sent, e.g. when another
  // workflow is starting at the same time. Reads retry on any transient error; a write retries only on that login-role failure, which is safe
  // because nothing has run yet. A write that fails any other way is never repeated.
  const isRead = /^\s*select /i.test(sqlText);
  return execWithRetry("npx", ["--yes", ...args], {}, isRead ? {} : { isRetryable: isLoginRoleFailure });
}

let applied = 0;
for (const f of added) {
  const version = basename(f).slice(0, 14);
  const name = basename(f).slice(15, -4);
  // Match on version OR name: a migration applied by hand earlier may be recorded under a different version than its filename
  // (the recurring hand-typed-timestamp drift), and re-running it would duplicate its effects.
  const seen = query(
    `select case when exists (select 1 from supabase_migrations.schema_migrations where version = '${version}' or name = '${name}') then 'ALREADY' else 'NEW' end as s`,
  );
  if (/ALREADY/.test(seen)) {
    console.log(`skip ${version} ${name}: already in schema_migrations (by version or name)`);
    continue;
  }
  const body = readFileSync(f, "utf8");
  if (/^\s*(begin|commit|rollback)\s*;/im.test(body)) {
    console.error(`STOP ${f}: the file manages its own transaction; apply it by hand.`);
    process.exit(1);
  }
  console.log(`applying ${version} ${name} ...`);
  const wrapped = `begin;\n${body}\n;\ninsert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name}') on conflict (version) do nothing;\ncommit;\n`;
  try {
    query(wrapped);
  } catch (err) {
    console.error(`FAILED ${f}: ${err instanceof Error ? err.message.split("\n").slice(0, 6).join("\n") : err}`);
    console.error("later migrations in this push were NOT applied. Fix forward or apply by hand, then re-run the workflow.");
    process.exit(1);
  }
  applied++;
}
console.log(`done: ${applied} applied, ${added.length - applied} skipped.`);
