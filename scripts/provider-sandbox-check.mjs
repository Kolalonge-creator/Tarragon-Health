#!/usr/bin/env node
// Usage: node --env-file=.env.sandbox scripts/provider-sandbox-check.mjs [--only paystack,zoom,resend,termii] [--allow-zoom-meeting] [--json out.json]
// See docs/runbooks/provider-sandbox-check.md. Exit 0: nothing failed and something passed. 1: a check failed. 2: refused (live key) or no credentials.
import { writeFileSync } from "node:fs";
import { makeRedactor, refusal, renderResults, runChecks } from "./provider-sandbox-check/checks.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const only = (value("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const redact = makeRedactor(process.env);

const stop = refusal(process.env);
if (stop) {
  console.error(redact(`REFUSED: ${stop}`));
  process.exit(2);
}
// fetch is the platform's own; the adapters only use text(), status and ok.
const out = await runChecks({ env: process.env, fetch: (url, init) => fetch(url, init), only, allowZoomMeeting: flag("--allow-zoom-meeting") });
console.log(renderResults(out.results, redact));
if (value("--json")) writeFileSync(value("--json"), redact(JSON.stringify(out.results, null, 2)));
const failed = out.results.some((r) => r.status === "FAIL");
const passed = out.results.some((r) => r.status === "PASS");
process.exit(failed ? 1 : passed ? 0 : 2);
