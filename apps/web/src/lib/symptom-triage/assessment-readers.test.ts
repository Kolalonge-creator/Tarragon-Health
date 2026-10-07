/**
 * INV-12 (S59b): symptom_triage_assessments has no org-wide staff read any more. This scan fails if application code starts selecting the
 * table (or the safety-monitoring view) directly from anywhere other than the patient's own actions: staff read through the audited
 * functions (read_symptom_session_audited, symptom_safety_monitoring), which carry the per-patient tie.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = [join(__dirname, "..", "..", ".."), join(__dirname, "..", "..", "..", "..", "mobile", "src"), join(__dirname, "..", "..", "..", "..", "console", "src")];
const ALLOWED = new Set(["symptom-handoff-actions.ts", "symptom-triage-actions.ts", "symptom-triage-unrecorded.test.ts", "run-step.ts", "assessment-readers.test.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === ".next") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

describe("no direct staff read of symptom assessments", () => {
  it("only the patient's own actions touch the table or the monitoring view", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const f of walk(root)) {
        const name = f.split("/").pop() ?? "";
        if (ALLOWED.has(name) || name === "database.types.ts") continue;
        const src = readFileSync(f, "utf8");
        if (/\.from\(\s*["'](symptom_triage_assessments|triage_safety_monitoring)["']/.test(src)) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});
