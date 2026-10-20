// Fails when any vendor-facing adapter module has an uncovered branch, line or function. Reads the coverage jest just wrote.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FILES = ["payment-paystack", "video-zoom", "email-resend", "http", "webhook-inbox", "webhook-forward", "webhook-body", "webhook-challenge", "crypto", "result", "from-env"];
const cov = JSON.parse(readFileSync(resolve(here, "../../coverage/coverage-final.json"), "utf8"));
let bad = 0;
for (const name of FILES) {
  const key = Object.keys(cov).find((k) => k.endsWith(`/_shared/integrations/${name}.ts`));
  if (!key) {
    console.error(`no coverage data for ${name}.ts`);
    bad += 1;
    continue;
  }
  const d = cov[key];
  const missed = [
    ...Object.entries(d.b).flatMap(([id, c]) => c.map((n, i) => (n === 0 ? `branch@${d.branchMap[id].locations[i]?.start.line ?? d.branchMap[id].loc.start.line}` : null))),
    ...Object.entries(d.f).map(([id, n]) => (n === 0 ? `function@${d.fnMap[id].loc.start.line}` : null)),
    ...Object.entries(d.s).map(([id, n]) => (n === 0 ? `statement@${d.statementMap[id].start.line}` : null)),
  ].filter(Boolean);
  if (missed.length > 0) {
    console.error(`${name}.ts is not fully covered: ${[...new Set(missed)].join(", ")}`);
    bad += 1;
  }
}
if (bad > 0) process.exit(1);
console.log(`adapter modules at 100% (${FILES.length} files)`);
