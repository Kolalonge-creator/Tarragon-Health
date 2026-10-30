#!/usr/bin/env node
// W-36 (b): act as the anon role and count the rows it can read in every table and view outside the system schemas.
// Only counts are returned: no row content ever leaves the database.
//
// How: a temporary function (in pg_temp, gone at rollback) switches to the anon role for each relation, counts, switches back and
// records the result. It FAILS CLOSED:
//   - only SQLSTATE 42501 (insufficient_privilege) counts as "anon is refused" (status 'denied', count 0);
//   - any other error is recorded as status 'error' and the script exits 2;
//   - after each role switch the function checks current_user = 'anon', so a switch that did nothing cannot read as "zero rows";
//   - a POSITIVE CONTROL: public.consent_versions is public by design and must return at least one row as anon. If it does not, the
//     scan did not really run as anon (or the output was not read), and the script exits 2 instead of passing.
//
// It reports and fails on:
//   leak      a table or view anon can read rows from that is not on PUBLIC_BY_DESIGN or KNOWN_REPORTED;
//   rls_open  a table with row security OFF that anon can read at all (even with zero rows now);
//   broken_public  a PUBLIC_BY_DESIGN table anon is refused on (42501) or that is missing from the scan. Refusal is the safe answer for
//             every other table, but for these it is the bug: the public page silently shows nothing (found 2026-10-29: a policy
//             calling a private.* function made anon reads of marketing_resources and public_impact_metrics fail with 42501).
// and prints (never fails on): known reported findings, views anon can read, and the storage schema (public buckets are by design).
//
// Output shape: the CLI's handling of a multi-statement file was NOT verified against the real CLI (Docker and the CLI were not used
// when this was written). Through the Supabase MCP, `begin; create function; select ...; rollback;` returns the select's rows. So
// extractRows() accepts any JSON shape (flat array, {rows}, array of result sets) and the positive control fails the run if the rows
// are missing.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node check-anon-zero-rows.mjs          (live project, Release Integrity)
//        node check-anon-zero-rows.mjs --local                              (local replay database through psql, PR CI)

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execWithRetry } from "./retry-sync.mjs";

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

// Found on the live project 2026-10-27: anon holds SELECT on these. They belong to Supabase-managed schemas, not to Tarragon code.
// They are REPORTED on every run and do not fail it, so the gate passes today; a new entry outside this list does fail.
// net._http_response and net.http_request_queue have row security off; whether anon should read pg_net's response log at all is a
// founder/security decision (listed in the PR as an open question).
export const KNOWN_REPORTED = new Set([
  "extensions.pg_stat_statements",
  "extensions.pg_stat_statements_info",
  "net._http_response",
  "net.http_request_queue",
  "realtime.subscription",
  "realtime.messages",
]);

export const POSITIVE_CONTROL = "public.consent_versions";

export const QUERY = `
begin;
create function pg_temp.anon_row_counts() returns table(schema_name text, rel_name text, kind text, rls_enabled boolean, status text, row_count bigint, err text)
language plpgsql as $f$
declare r record; n bigint;
begin
  for r in
    select nsp.nspname as s, c.relname as t, c.relkind::text as k, c.relrowsecurity as rls
      from pg_class c join pg_namespace nsp on nsp.oid = c.relnamespace
     where c.relkind in ('r','p','v','m','f')
       and nsp.nspname not in ('pg_catalog','information_schema')
       and nsp.nspname !~ '^pg_toast'
     order by 1, 2
  loop
    schema_name := r.s; rel_name := r.t; kind := r.k; rls_enabled := r.rls; err := null; n := null;
    begin
      set local role anon;
      if current_user <> 'anon' then
        raise exception 'role switch to anon did not take effect (current_user is %)', current_user using errcode = 'XX000';
      end if;
      execute format('select count(*) from (select 1 from %I.%I limit 1) x', r.s, r.t) into n;
      reset role;
      status := 'ok';
    exception
      when insufficient_privilege then
        reset role; n := 0; status := 'denied';
      when others then
        reset role; n := null; status := 'error'; err := sqlstate || ': ' || sqlerrm;
    end;
    row_count := n;
    return next;
  end loop;
  -- storage: list the public buckets (public by design, printed for review, never failed on)
  for r in select id from storage.buckets where public order by id loop
    schema_name := 'storage'; rel_name := 'bucket:' || r.id; kind := 'bucket'; rls_enabled := true; status := 'ok'; row_count := 1; err := null;
    return next;
  end loop;
end $f$;
select schema_name, rel_name, kind, rls_enabled, status, row_count, err from pg_temp.anon_row_counts();
rollback;
`;

/** Same scan for a local database (the PR replay job): psql prints the rows as one JSON array. */
export const QUERY_JSON = QUERY.replace(
  "select schema_name, rel_name, kind, rls_enabled, status, row_count, err from pg_temp.anon_row_counts();",
  "select coalesce(json_agg(t), '[]'::json) from pg_temp.anon_row_counts() t;",
);

/**
 * Pull the scan rows out of whatever the CLI printed. Walks every balanced {...} or [...] structure, descends through arrays,
 * `rows` fields and arrays of result sets, and keeps objects that carry a row_count. Never throws: an empty result is handled by
 * evaluate() (the positive control fails).
 */
export function extractRows(raw) {
  const found = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if ("row_count" in v && "rel_name" in v) found.push(v);
      else Object.values(v).forEach(walk);
    }
  };
  let i = 0;
  while (i < raw.length) {
    const start = raw.slice(i).search(/[{[]/);
    if (start === -1) break;
    const abs = i + start;
    const open = raw[abs];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let end = -1;
    let inStr = false;
    for (let j = abs; j < raw.length; j++) {
      const ch = raw[j];
      if (inStr) {
        if (ch === "\\") j++;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close && --depth === 0) {
        end = j;
        break;
      }
    }
    if (end === -1) break;
    try {
      walk(JSON.parse(raw.slice(abs, end + 1)));
    } catch {
      /* a status blob that is not JSON: skip it */
    }
    i = end + 1;
  }
  return found;
}

const id = (r) => `${r.schema_name}.${r.rel_name}`;

/**
 * rows: [{schema_name, rel_name, kind, rls_enabled, status, row_count, err}].
 * Returns { leaks, rlsOpen, brokenPublic, errors, controlOk, reported, views, buckets, scanned }.
 */
export function evaluate(rows) {
  const rels = rows.filter((r) => r.kind !== "bucket");
  const control = rels.find((r) => id(r) === POSITIVE_CONTROL);
  const controlOk = !!control && control.status === "ok" && Number(control.row_count) >= 1;
  const errors = rels.filter((r) => r.status === "error").map((r) => `${id(r)} (${r.err})`);
  const readable = rels.filter((r) => r.status === "ok" && r.schema_name !== "storage");
  const okToRead = (r) => PUBLIC_BY_DESIGN.has(id(r));
  const brokenPublic = [...PUBLIC_BY_DESIGN].filter((t) => {
    const r = rels.find((x) => id(x) === t);
    return !r || r.status !== "ok";
  }).map((t) => {
    const r = rels.find((x) => id(x) === t);
    return r ? `${t} (${r.status}${r.err ? `: ${r.err}` : ""})` : `${t} (not found in the scan)`;
  });
  return {
    brokenPublic,
    scanned: rels.length,
    controlOk,
    errors,
    leaks: readable.filter((r) => Number(r.row_count) > 0 && !okToRead(r) && !KNOWN_REPORTED.has(id(r))).map(id),
    rlsOpen: readable.filter((r) => (r.kind === "r" || r.kind === "p") && r.rls_enabled === false && !okToRead(r) && !KNOWN_REPORTED.has(id(r))).map(id),
    reported: readable.filter((r) => KNOWN_REPORTED.has(id(r))).map((r) => `${id(r)} (rows ${r.row_count}, row security ${r.rls_enabled ? "on" : "OFF"})`),
    views: readable.filter((r) => (r.kind === "v" || r.kind === "m") && !okToRead(r)).map((r) => `${id(r)} (rows ${r.row_count})`),
    buckets: rows.filter((r) => r.kind === "bucket").map((r) => r.rel_name.replace("bucket:", "")),
  };
}

function main() {
  const localUrl = process.argv.includes("--local") ? process.env.LOCAL_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres" : null;
  if (!localUrl && !process.env.SUPABASE_ACCESS_TOKEN) {
    console.error("SUPABASE_ACCESS_TOKEN is not set: cannot run the anon row check.");
    process.exit(2);
  }
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
  if (!localUrl) execWithRetry("npx", ["--yes", "supabase", "link", "--project-ref", PROJECT_REF, "--yes", "--workdir", root]);
  const dir = mkdtempSync(join(tmpdir(), "anon-zero-rows-"));
  const file = join(dir, "query.sql");
  writeFileSync(file, localUrl ? QUERY_JSON : QUERY);
  let raw;
  try {
    raw = localUrl
      ? execFileSync("psql", [localUrl, "-q", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", file], { encoding: "utf8", maxBuffer: 1024 * 1024 * 50 })
      : execWithRetry("npx", ["--yes", "supabase", "db", "query", "--linked", "-f", file, "--output-format", "json"], { env: { ...process.env } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const res = evaluate(extractRows(raw));
  if (res.scanned < 100) {
    console.error(`Only ${res.scanned} relations were scanned (expected hundreds). The query result was not read; refusing to pass.\nFirst 400 characters of output: ${raw.slice(0, 400)}`);
    process.exit(2);
  }
  if (!res.controlOk) {
    console.error(`POSITIVE CONTROL FAILED: ${POSITIVE_CONTROL} is public by design and must return at least one row as anon. It did not, so this scan did not truly run as anon. Refusing to pass.`);
    process.exit(2);
  }
  if (res.errors.length) {
    console.error(`${res.errors.length} relation(s) failed with an error other than "permission denied":`);
    for (const e of res.errors) console.error(`  ${e}`);
    process.exit(2);
  }
  for (const r of res.reported) console.log(`REPORTED (known, not failing): ${r}`);
  for (const v of res.views) console.log(`REPORT: view readable by anon: ${v}`);
  console.log(`Public buckets (by design): ${res.buckets.join(", ") || "none"}`);
  if (res.leaks.length === 0 && res.rlsOpen.length === 0 && res.brokenPublic.length === 0) {
    console.log(`OK: anon read zero rows from ${res.scanned} relations outside the public-by-design and known-reported lists (positive control passed).`);
    return;
  }
  if (res.leaks.length) {
    console.error(`\n${res.leaks.length} relation(s) return rows to the anon role and are not public by design:`);
    for (const t of res.leaks) console.error(`  ${t}`);
  }
  if (res.rlsOpen.length) {
    console.error(`\n${res.rlsOpen.length} table(s) have row security OFF and anon can read them:`);
    for (const t of res.rlsOpen) console.error(`  ${t}`);
  }
  if (res.brokenPublic.length) {
    console.error(`\n${res.brokenPublic.length} public-by-design table(s) are not readable by anon (the public page would show nothing):`);
    for (const t of res.brokenPublic) console.error(`  ${t}`);
  }
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
