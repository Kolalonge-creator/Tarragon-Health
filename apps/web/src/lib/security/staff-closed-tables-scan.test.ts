import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * OQ-54 standing guard (INV-10). The ten health-record tables below have no RLS
 * policy that admits staff (S05b to S05f): a staff session reading one directly
 * gets an empty list, which a screen then shows as "none on file". Staff screens
 * must read through the audited, tie-gated functions (read_patient_chart_audited
 * and the per-surface readers). This scan fails if a staff screen adds a direct
 * `.from("<table>")` read or a PostgREST embed of one of these tables.
 *
 * Patient, mobile and server-only (service role) code is out of scope here.
 */
const CLOSED_TABLES = [
  "vitals_readings",
  "medications",
  "medication_logs",
  "symptoms",
  "patient_conditions",
  "patient_allergies",
  "clinical_encounter_notes",
  "specialist_referrals",
  "patient_documents",
  "family_history",
] as const;

const WEB_SRC = resolve(process.cwd(), "src");
const REPO_APPS = resolve(process.cwd(), "..");
const STAFF_ROOTS = [
  "clinician",
  "admin",
  "doctor",
  "pharmacist",
  "lab-liaison",
  "lab-partner",
  "credentialing",
  "rota",
  "finance",
  "analytics",
  "payer",
  "provider-org",
].map((d) => join(WEB_SRC, "app", "(dashboard)", d));
STAFF_ROOTS.push(join(REPO_APPS, "console", "src"));

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const tableAlt = CLOSED_TABLES.join("|");
const DIRECT_FROM = new RegExp(`\\.from\\(\\s*["'\`](${tableAlt})["'\`]`);
// An embed inside a select string: `medications(`, `medications!inner(`, `alias:medications(`.
const EMBED = new RegExp(`[\\s,:(\`"'](${tableAlt})\\s*(!\\w+)?\\s*\\(`);

describe("staff screens never read the closed health-record tables directly (OQ-54)", () => {
  const files = STAFF_ROOTS.flatMap((r) => walk(r));

  it("scans a non-trivial number of staff files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("has no direct .from() read of a closed table", () => {
    const offenders = files
      .filter((f) => DIRECT_FROM.test(readFileSync(f, "utf8")))
      .map((f) => relative(REPO_APPS, f));
    expect(offenders).toEqual([]);
  });

  it("has no PostgREST embed of a closed table in a select", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const selects = src.match(/\.select\(\s*(`[^`]*`|"[^"]*"|'[^']*')/g) ?? [];
      if (selects.some((s) => EMBED.test(s))) offenders.push(relative(REPO_APPS, f));
    }
    expect(offenders).toEqual([]);
  });

  it("the detector itself discriminates", () => {
    expect(DIRECT_FROM.test(`supabase.from("medications").select("*")`)).toBe(true);
    expect(DIRECT_FROM.test(`supabase.from("profiles").select("*")`)).toBe(false);
    expect(EMBED.test(`.select("id, medications(id)")`)).toBe(true);
    expect(EMBED.test(`.select("id, symptoms!inner(id)")`)).toBe(true);
    expect(EMBED.test(`.select("id, medication_name")`)).toBe(false);
  });
});
