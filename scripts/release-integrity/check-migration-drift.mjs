#!/usr/bin/env node
// Automates the manual audit CLAUDE.md's memory notes describe running by hand every few days
// (most recently confirmed live on 2026-08-12: 21 drifted rows, mostly migrations applied to
// the production DB from feature branches — worktree-diabetes-pathway-closure/PR#223,
// claude/health-passport-signed-credential-20260807, claude/consent-scoped-family-care-graph-
// 20260807, worktree-fhir-interoperability — that were never merged into main-dev/main). That's
// "feature branches merged in DB but not app code": the schema is live and code depends on it
// existing, but the migration file (and the app code in the same branch) never landed on main.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node check-migration-drift.mjs
// Exits non-zero if any migration is applied-but-uncommitted, committed-but-unapplied, or if a
// remote-only migration can't be traced to any commit in git history at all (true loss risk).

import { execFileSync } from "node:child_process";
import { join } from "node:path";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "koiplnmbgnqnbywhpjlf";
const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 50, ...opts });
}

function findOwningBranch(version) {
  // Which commit (if any) first added this migration file, and which remote branches contain it.
  let commit;
  try {
    commit = sh("git", [
      "-C", REPO_ROOT, "log", "--all", "--format=%H", "--diff-filter=A",
      "--", `supabase/migrations/${version}_*.sql`,
    ]).trim().split("\n")[0];
  } catch {
    commit = "";
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

function main() {
  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    console.error("SUPABASE_ACCESS_TOKEN is not set — cannot check migration drift.");
    process.exit(2);
  }

  // Hand-writing supabase/.temp/project-ref (skipping `supabase link`) leaves the CLI without
  // pooler connection info, so `migration list --linked` falls back to a direct IPv6-only DB
  // connection that GitHub-hosted runners can't reach (LegacyDbConfigIpv6Error). Running `link`
  // itself, non-interactively, makes the CLI default to the IPv4-compatible pooler instead —
  // confirmed 2026-08-31 by reproducing the failure and the fix locally against the live project.
  sh("npx", ["--yes", "supabase", "link", "--project-ref", PROJECT_REF, "--yes", "--workdir", REPO_ROOT]);

  console.log(`Comparing local migrations against what's applied on project ${PROJECT_REF}...`);
  const raw = sh("npx", ["--yes", "supabase", "migration", "list", "--linked", "--output-format", "json", "--workdir", REPO_ROOT]);
  const jsonLine = raw.trim().split("\n").filter((l) => l.trim().startsWith("{")).pop();
  if (!jsonLine) {
    console.error("Could not parse `supabase migration list` output:\n" + raw);
    process.exit(2);
  }
  const { migrations } = JSON.parse(jsonLine);

  const localOnly = migrations.filter((m) => m.local && !m.remote);
  const remoteOnly = migrations.filter((m) => m.remote && !m.local);

  if (localOnly.length === 0 && remoteOnly.length === 0) {
    console.log(`OK: ${migrations.length} migrations, local and remote match exactly.`);
    return;
  }

  if (localOnly.length > 0) {
    console.error(`\n${localOnly.length} migration(s) committed locally but never applied to the live project:`);
    for (const m of localOnly) console.error(`  ${m.local}  (committed ${m.time}, not yet run)`);
  }

  if (remoteOnly.length > 0) {
    console.error(`\n${remoteOnly.length} migration(s) applied live with no matching local file (checked against every branch in git history):`);
    for (const m of remoteOnly) {
      const { commit, branches } = findOwningBranch(m.remote);
      if (!commit) {
        console.error(`  ${m.remote} (applied ${m.time})  -- NOT FOUND IN ANY COMMIT ANYWHERE. Recover it now with:`);
        console.error(`      supabase migration fetch ${m.remote} --project-ref ${PROJECT_REF}   # or pull statements via the DB and commit them`);
      } else if (branches.length === 0) {
        console.error(`  ${m.remote} (applied ${m.time})  -- committed at ${commit.slice(0, 12)} but on no remote branch (local/unpushed only).`);
      } else {
        console.error(`  ${m.remote} (applied ${m.time})  -- on ${branches.join(", ")}, not merged into main-dev/main yet.`);
      }
    }
  }

  console.error(
    `\nThis means production schema and committed app code have diverged: something that's live in the ` +
      `database either isn't on main yet, or was never committed at all. Resolve by merging the owning ` +
      `branch(es) above, or committing the untraced migration(s), before the next release.`,
  );
  process.exit(1);
}

main();
