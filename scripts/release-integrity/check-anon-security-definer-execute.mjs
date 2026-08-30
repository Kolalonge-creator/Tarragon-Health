#!/usr/bin/env node
// Catches the bug documented in the supabase-anon-execute-gotcha memory: a freshly created
// SECURITY DEFINER function carries an implicit EXECUTE grant to the PUBLIC pseudo-role, so
// `grant execute on function X to authenticated` without a preceding `revoke ... from public`
// leaves the function callable by `anon` (fully unauthenticated). This has shipped to production
// three times — fixed 2026-07-27, swept project-wide 2026-07-29, then recurred 2026-08-29 in five
// brand-new functions (finance_fraud_signals, finance_resolve_fraud_signal, get_or_create_invoice,
// invoice_letterhead_details, patient_receipts) that skipped the revoke entirely. Each prior sweep
// only fixed functions that existed at the time; nothing stopped the next migration from
// reintroducing the gap. This script is that missing guardrail.
//
// Scoped to `public` and `private`: `public` is what PostgREST exposes over the anon/authenticated
// API keys, so it's the schema where this bug is directly reachable by an unauthenticated caller.
// `private` is not PostgREST-exposed, so a gap there is defense-in-depth rather than an active
// breach — but it drifted independently (found 2026-08-29, closed in
// 20260829111514_resweep_private_schema_execute_from_public.sql): the 2026-08-12 sweep's own
// `ALTER DEFAULT PRIVILEGES` was assumed to make it self-healing and does not (verified three
// ways — see the supabase-anon-execute-gotcha memory), so only a check that runs on every push
// actually catches the next drift there too.
//
// Excludes trigger/event-trigger functions: a function with RETURNS TRIGGER or RETURNS
// EVENT_TRIGGER cannot be invoked directly via SQL regardless of its EXECUTE grant ("trigger
// functions can only be called as triggers"), so flagging them would be permanent, unactionable
// noise, not a real finding.
//
// A handful of public-schema SECURITY DEFINER functions are deliberately anon-executable by
// design (see ALLOWLIST below) — each one carries its own migration-level assertion pinning that
// intent (e.g. "emergency_card_by_token must be anon-executable — that is the point"). Anything
// else showing up as anon-executable is the bug.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node check-anon-security-definer-execute.mjs
// Exits non-zero if any non-allowlisted SECURITY DEFINER function in `public` or `private` is
// anon-executable.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "koiplnmbgnqnbywhpjlf";
const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();

// Each entry is the exact `schema.function(identity_arguments)` signature, matched against
// `pg_get_function_identity_arguments()` output so overloaded names can't slip an unreviewed
// sibling past the list. Every entry below has a migration-level assertion of its own proving the
// anon grant is deliberate -- see the comment next to each for where.
const ALLOWLIST = new Set([
  // 20260803145146_emergency_cards.sql -- "emergency_card_by_token must be anon-executable —
  // that is the point": a first responder scans a QR/link with no patient login involved.
  "public.emergency_card_by_token(p_token text)",
  // 20260807104733_health_passport_signed_credential.sql -- "health_passport_by_serial must be
  // anon-executable — that is the feature": a third party verifies a passport by serial + DOB.
  "public.health_passport_by_serial(p_serial text, p_dob date)",
  // 20260825181546_public_partner_locations.sql -- public /coverage map, no login required.
  "public.public_partner_locations()",
  // 20260729141426_public_price_list_rpc.sql -- public pricing page, no login required.
  "public.public_price_list()",
  // 20260731015335_public_response_commitments.sql -- public trust/SLA commitments page.
  "public.public_response_commitments()",
  // 20260731014200_public_service_coverage.sql -- public service-area coverage page.
  "public.public_service_coverage()",
]);

const QUERY = `
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  p.prorettype::regtype::text as return_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private')
  and p.prosecdef
  and p.prokind = 'f'
  and p.prorettype::regtype::text not in ('trigger', 'event_trigger')
  and has_function_privilege('anon', p.oid, 'EXECUTE')
order by n.nspname, p.proname;
`;

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 50, ...opts });
}

function parseRows(raw) {
  const lines = raw.split("\n");
  const startIdx = lines.findIndex((l) => l.trim() === "{");
  if (startIdx === -1) {
    console.error("Could not find JSON output in `supabase db query` output:\n" + raw);
    process.exit(2);
  }
  const parsed = JSON.parse(lines.slice(startIdx).join("\n"));
  return parsed.rows;
}

// Exported shape for the pass/fail decision, kept separate from the DB round-trip so it can be
// exercised directly against a synthetic rows array (see the sabotage-test note in the PR/commit
// this script shipped with).
export function evaluate(rows) {
  const offenders = rows.filter((r) => {
    const signature = `${r.schema_name}.${r.function_name}(${r.args})`;
    return !ALLOWLIST.has(signature);
  });
  return offenders;
}

function main() {
  const tempDir = join(REPO_ROOT, "supabase", ".temp");
  mkdirSync(tempDir, { recursive: true });
  writeFileSync(join(tempDir, "project-ref"), PROJECT_REF);

  const queryDir = mkdtempSync(join(tmpdir(), "anon-execute-check-"));
  const queryFile = join(queryDir, "query.sql");
  writeFileSync(queryFile, QUERY);

  try {
    console.log(`Checking anon EXECUTE on SECURITY DEFINER functions in public/private schemas of project ${PROJECT_REF}...`);
    const raw = sh("npx", ["--yes", "supabase", "db", "query", "--linked", "-f", queryFile, "--output-format", "json"], {
      env: { ...process.env },
    });
    const rows = parseRows(raw);
    const offenders = evaluate(rows);

    if (offenders.length === 0) {
      console.log(`OK: no non-allowlisted SECURITY DEFINER function in public/private is anon-executable (${rows.length} allowlisted).`);
      return;
    }

    console.error(`\n${offenders.length} SECURITY DEFINER function(s) are anon-executable and NOT on the allowlist:`);
    for (const r of offenders) {
      console.error(`  ${r.schema_name}.${r.function_name}(${r.args})  -- returns ${r.return_type}`);
    }
    console.error(
      `\nThis is the anon-inherits-EXECUTE-via-PUBLIC bug (see the supabase-anon-execute-gotcha memory) -- ` +
        `the function's migration granted EXECUTE to authenticated without first doing ` +
        `\`revoke all on function <fn> from public, anon;\`. Fix each one with a migration that revokes from ` +
        `public (and anon directly, in case of a stray direct grant) before (re-)granting to authenticated, ` +
        `and add a has_function_privilege('anon', ..., 'EXECUTE') assertion in its DO block. If the anon ` +
        `access is genuinely intentional, add the exact signature to ALLOWLIST in ` +
        `scripts/release-integrity/check-anon-security-definer-execute.mjs with a comment pointing at the ` +
        `migration's own assertion proving the intent. Do NOT rely on ALTER DEFAULT PRIVILEGES to prevent ` +
        `recurrence -- proven not to work on this project, see the same memory.`,
    );
    process.exit(1);
  } finally {
    rmSync(queryDir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
