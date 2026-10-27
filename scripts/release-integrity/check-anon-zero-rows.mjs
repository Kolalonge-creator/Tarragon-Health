#!/usr/bin/env node
// W-36 (b): act as the anon role and count the rows it can read in every row-secured table.
// Only counts are returned: no row content ever leaves the database.
//
// How: a temporary function (in pg_temp, gone at rollback) switches to the anon role for each table,
// counts, switches back, and records the count. A table anon cannot reach at all (no grant, no schema
// usage) counts as 0. The whole thing runs inside begin/rollback, so it writes nothing.
//
// Passes when every table with a readable row is on PUBLIC_BY_DESIGN. Anything else is a leak.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node check-anon-zero-rows.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execWithRetry } from "./retry-sync.mjs";
import { parseRows } from "./check-minor-guard-gaps.mjs";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "koiplnmbgnqnbywhpjlf";

// Tables anon may read on purpose, each behind its own row policy (catalogue read 2026-10-27).
// Add one only with a reason in the PR; a new entry is a new public surface.
export const PUBLIC_BY_DESIGN = new Set([
  "public.consent_versions", // signup shows the consent text before an account exists
  "public.doctor_testimonials", // marketing site, published rows only
  "public.patient_testimonials", // marketing site, published rows only
  "public.marketing_resources", // marketing site downloads
  "public.public_impact_metrics", // public impact page
  "public.passport_signing_keys", // public keys so a third party can verify a health passport
]);

export const QUERY = `
begin;
create function pg_temp.anon_row_counts() returns table(table_name text, row_count bigint)
language plpgsql as $f$
declare r record; n bigint;
begin
  for r in
    select nsp.nspname as s, c.relname as t
      from pg_class c join pg_namespace nsp on nsp.oid = c.relnamespace
     where c.relkind in ('r','p') and c.relrowsecurity
       and nsp.nspname not in ('pg_catalog','information_schema','auth','storage','realtime','vault','extensions','graphql','graphql_public','pgsodium','pgsodium_masks','net','cron','pgbouncer','supabase_migrations','supabase_functions','_realtime')
  loop
    begin
      set local role anon;
      execute format('select count(*) from (select 1 from %I.%I limit 1) x', r.s, r.t) into n;
      reset role;
    exception when others then
      reset role;
      n := 0;
    end;
    table_name := r.s || '.' || r.t; row_count := n; return next;
  end loop;
end $f$;
select table_name, row_count from pg_temp.anon_row_counts();
rollback;
`;

/** rows: [{table_name, row_count}]. Returns the leaks: readable tables not allowed, and the scanned total. */
export function evaluate(rows) {
  const leaks = rows
    .filter((r) => Number(r.row_count) > 0 && !PUBLIC_BY_DESIGN.has(r.table_name))
    .map((r) => r.table_name);
  return { leaks, scanned: rows.length };
}

function main() {
  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    console.error("SUPABASE_ACCESS_TOKEN is not set: cannot run the anon row check.");
    process.exit(2);
  }
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
  execWithRetry("npx", ["--yes", "supabase", "link", "--project-ref", PROJECT_REF, "--yes", "--workdir", root]);
  const dir = mkdtempSync(join(tmpdir(), "anon-zero-rows-"));
  const file = join(dir, "query.sql");
  writeFileSync(file, QUERY);
  let raw;
  try {
    raw = execWithRetry("npx", ["--yes", "supabase", "db", "query", "--linked", "-f", file, "--output-format", "json"], { env: { ...process.env } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const rows = parseRows(raw);
  const { leaks, scanned } = evaluate(rows);
  if (scanned < 100) {
    console.error(`Only ${scanned} row-secured tables were scanned; expected the full catalogue. Refusing to pass on a partial scan.`);
    process.exit(2);
  }
  if (leaks.length === 0) {
    console.log(`OK: anon read zero rows from ${scanned} row-secured tables (${PUBLIC_BY_DESIGN.size} public-by-design tables excepted).`);
    return;
  }
  console.error(`\n${leaks.length} table(s) return rows to the anon role and are not public by design:`);
  for (const t of leaks) console.error(`  ${t}`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
