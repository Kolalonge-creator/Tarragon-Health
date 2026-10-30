#!/usr/bin/env node
// W-40: run scripts/load/k6/queue-next.js after checking the doctor-sessions file.
//   node scripts/load/run-queue-next.mjs --sessions /abs/path/sessions.json --stage A -- [extra k6 args]
// Needs SUPABASE_URL and SUPABASE_ANON_KEY in the environment (and LOAD_TEST_PROJECT_REFS for a hosted scratch project).
// Refuses to start when: the sessions file is inside the git work tree and is tracked (or not ignored), a token is a service-role token,
// or the target is not on the allowlist in scripts/load/k6/stages.js. See scripts/load/README.md.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkTarget } from "./k6/stages.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** git(args) returns { code, out }. Injected so the check can be tested without a repository. */
function defaultGit(args, cwd) {
  try {
    return { code: 0, out: execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: "" };
  }
}

export function jwtRole(jwt) {
  try {
    return JSON.parse(Buffer.from(String(jwt).split(".")[1], "base64url").toString("utf8")).role ?? null;
  } catch {
    return null;
  }
}

/** Returns a list of problems; empty means the sessions file may be used. */
export function checkSessionsFile(path, { git = defaultGit, readFile = (p) => readFileSync(p, "utf8"), repoRootOf = () => null } = {}) {
  const problems = [];
  if (!path || !isAbsolute(path)) return ["--sessions must be an absolute path"];
  const dir = dirname(path);
  const root = repoRootOf(dir) ?? (git(["rev-parse", "--show-toplevel"], dir).out.trim() || null);
  if (root) {
    const rel = relative(root, path);
    if (!rel.startsWith("..")) {
      if (git(["ls-files", "--error-unmatch", rel], root).code === 0) problems.push(`${rel} is TRACKED by git. Remove it from the index and keep tokens outside the repository.`);
      if (git(["check-ignore", "-q", rel], root).code !== 0) problems.push(`${rel} is inside the work tree and not git-ignored. Name it sessions*.json or *.jwt, or move it outside the repository.`);
    }
  }
  let rows;
  try {
    rows = JSON.parse(readFile(path));
  } catch (e) {
    return [...problems, `cannot read ${path}: ${e.message}`];
  }
  if (!Array.isArray(rows) || rows.length === 0) problems.push("the sessions file must be a non-empty JSON array of {jwt}");
  else {
    const bad = rows.filter((r) => !r || typeof r.jwt !== "string");
    if (bad.length) problems.push(`${bad.length} entries have no jwt string`);
    if (rows.some((r) => r && jwtRole(r.jwt) === "service_role")) problems.push("a token has the service_role role. Use doctor (authenticated) sessions only.");
  }
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  const take = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const sessions = take("--sessions");
  const stage = take("--stage") || "A";
  const url = process.env.SUPABASE_URL;
  const target = checkTarget(url, process.env.LOAD_TEST_PROJECT_REFS);
  if (!target.ok) {
    console.error(`Target refused: ${target.reason}`);
    process.exit(2);
  }
  const problems = checkSessionsFile(sessions && resolve(sessions));
  if (problems.length) {
    for (const p of problems) console.error(`Sessions file: ${p}`);
    process.exit(2);
  }
  const extra = args.includes("--") ? args.slice(args.indexOf("--") + 1) : [];
  const res = spawnSync("k6", ["run", "-e", `TEST_SESSIONS_FILE=${resolve(sessions)}`, "-e", `STAGE=${stage}`, "-e", `SUPABASE_URL=${url}`, "-e", `SUPABASE_ANON_KEY=${process.env.SUPABASE_ANON_KEY ?? ""}`, "-e", `LOAD_TEST_PROJECT_REFS=${process.env.LOAD_TEST_PROJECT_REFS ?? ""}`, ...extra, join(HERE, "k6", "queue-next.js")], { stdio: "inherit" });
  process.exit(res.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
