import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * S05b-c: a superseded or entered_in_error row must not be counted by application code that can run with the service role
 * (row level security hides it from user sessions, the service role bypasses that).
 *
 * Every non-test file under apps/web/src/lib that reads vitals_readings, lab_analyte_readings, patient_allergies or
 * patient_conditions must mention `correction_status` (the filter `.is("correction_status", null)`), unless it is listed below as
 * a reader that only ever receives the signed-in user's own session client (so row level security already hides the row).
 * A new reader therefore has to make that decision on purpose.
 */
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const LIB = join(REPO_ROOT, "apps", "web", "src", "lib");
const TABLES = /\.from\("(vitals_readings|lab_analyte_readings|patient_allergies|patient_conditions)"\)/;

/** Receive a user-session client (checked 2026-10-14); RLS hides marked rows from them. */
const USER_SESSION_ONLY = new Set([
  "ai-coach/context.ts",
  "ai-coach/tools.ts",
  "data-export/get-full-patient-record.ts",
  "healthy-ageing/loaders.ts",
  "lifestyle/ingest.ts",
  "queries/vitals.ts",
  "queries/sponsorship.ts",
  "queries/weekly-summary.ts",
  "queries/conditions.ts",
  "queries/lipids.ts",
  "queries/allergies.ts",
  "health-passport/get-health-passport-data.ts",
  "wearables/ingest.ts",
  "patient-explainer/snapshot.ts",
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("readers of corrected tables skip marked rows", () => {
  const readers = walk(LIB)
    .map((f) => ({ rel: relative(LIB, f).split("\\").join("/"), src: readFileSync(f, "utf8") }))
    .filter(({ src }) => TABLES.test(src));

  it("finds the readers", () => {
    expect(readers.length).toBeGreaterThan(15);
  });

  it.each(readers.map((r) => [r.rel, r.src] as const))("%s filters or is user-session only", (rel, src) => {
    if (USER_SESSION_ONLY.has(rel)) return;
    const reads = (src.match(new RegExp(TABLES.source, "g")) ?? []).length;
    const filters = (src.match(/\.is\("correction_status", null\)/g) ?? []).length;
    expect(filters).toBeGreaterThanOrEqual(reads);
  });
});
