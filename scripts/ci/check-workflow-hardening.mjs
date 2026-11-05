#!/usr/bin/env node
// Security audit 2026-11-05 (M-10): every third-party GitHub Action is pinned to a full commit SHA (a moved tag cannot change
// what runs), and every workflow declares a top-level `permissions:` block (the token never gets the repository default).
// Local actions (`uses: ./...`) are exempt. Dependabot (github-actions ecosystem) keeps the pins and their version comments current.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = ".github/workflows";
const problems = [];
for (const name of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
  const text = readFileSync(join(dir, name), "utf8");
  if (!/^permissions:/m.test(text)) problems.push(`${name}: no top-level permissions block`);
  text.split("\n").forEach((line, i) => {
    const m = /^\s*-?\s*uses:\s*([^\s#]+)/.exec(line);
    if (!m || m[1].startsWith("./")) return;
    if (!/@[0-9a-f]{40}$/.test(m[1])) problems.push(`${name}:${i + 1}: ${m[1]} is not pinned to a commit SHA`);
  });
}
if (problems.length) {
  console.error("Workflow hardening check failed:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log("Workflow hardening check passed.");
