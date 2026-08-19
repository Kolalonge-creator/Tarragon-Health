#!/usr/bin/env node
// Catches the failure mode CLAUDE.md flags for send-pending-notifications: an edge function
// deployed straight from a working tree (via CLI/MCP) that then falls behind the committed
// source, with nothing ever comparing "what's live" against "what git says should be live".
// Confirmed still happening live on 2026-08-12: the deployed send-pending-notifications carries
// a diabetes_complication_check_due template from an unmerged branch (worktree-diabetes-
// pathway-closure, PR #223) that origin/main doesn't have yet.
//
// Downloads the currently-deployed source for every function via the Supabase CLI (--use-api,
// no Docker needed) and diffs it against supabase/functions/ as committed at a given git ref
// (default origin/main — "what production is supposed to be running", not the working tree,
// which may have unrelated in-flight edits).
//
// Usage: SUPABASE_ACCESS_TOKEN=... node check-edge-function-drift.mjs [gitRef]
// Exits non-zero if any deployed function differs from the git ref's committed source.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "koiplnmbgnqnbywhpjlf";
const GIT_REF = process.argv[2] || process.env.COMPARE_GIT_REF || "origin/main";
const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();

function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, base, out);
    else out.push(full.slice(base.length + 1));
  }
  return out;
}

function main() {
  const deployedDir = mkdtempSync(join(tmpdir(), "edge-fn-deployed-"));
  const sourceDir = mkdtempSync(join(tmpdir(), "edge-fn-source-"));

  try {
    console.log(`Downloading deployed function source for project ${PROJECT_REF}...`);
    execFileSync(
      "npx",
      ["--yes", "supabase", "functions", "download", "--project-ref", PROJECT_REF, "--use-api", "--workdir", deployedDir],
      { stdio: "inherit", env: { ...process.env } },
    );

    console.log(`Extracting supabase/functions/ as committed at ${GIT_REF}...`);
    execFileSync("mkdir", ["-p", sourceDir]);
    const archive = execFileSync(
      "git",
      ["-C", REPO_ROOT, "archive", GIT_REF, "--", "supabase/functions"],
      { maxBuffer: 1024 * 1024 * 100 },
    );
    execFileSync("tar", ["-x", "-C", sourceDir], { input: archive });

    const deployedFnDir = join(deployedDir, "supabase", "functions");
    const sourceFnDir = join(sourceDir, "supabase", "functions");
    const deployedFiles = new Set(walk(deployedFnDir).filter((f) => !f.includes(".temp")));
    const sourceFiles = new Set(walk(sourceFnDir));

    let drifted = false;
    const allFiles = new Set([...deployedFiles, ...sourceFiles]);
    for (const rel of [...allFiles].sort()) {
      const inDeployed = deployedFiles.has(rel);
      const inSource = sourceFiles.has(rel);
      if (inDeployed && !inSource) {
        console.error(`ONLY DEPLOYED (not in ${GIT_REF}): ${rel}`);
        drifted = true;
        continue;
      }
      if (inSource && !inDeployed) {
        console.error(`ONLY IN ${GIT_REF} (never deployed): ${rel}`);
        drifted = true;
        continue;
      }
      const a = readFileSync(join(deployedFnDir, rel), "utf8");
      const b = readFileSync(join(sourceFnDir, rel), "utf8");
      if (a !== b) {
        console.error(`DRIFTED: ${rel} (deployed source differs from ${GIT_REF})`);
        drifted = true;
      }
    }

    if (drifted) {
      console.error(
        `\nOne or more edge functions are out of sync with ${GIT_REF}. Either redeploy from ${GIT_REF}, or the ` +
          `deployed version carries unmerged work that needs a PR — check which before overwriting production.`,
      );
      process.exit(1);
    }

    console.log(`OK: all deployed edge functions match ${GIT_REF}.`);
  } finally {
    rmSync(deployedDir, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
}

main();
