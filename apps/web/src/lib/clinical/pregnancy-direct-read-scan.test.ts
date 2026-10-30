import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * OQ-555 follow-up: a safety check must never read pregnancy or postnatal status straight from the table and default a missing row to "not pregnant".
 * Under row security a clinician who is not tied (or a viewer who may not look) gets null data and no error, which a `?? false` turns into "not pregnant".
 * Safety code reads `readPregnancySafety` (lib/clinical/pregnancy-status.ts), which answers pregnant | not_pregnant | unknown from the database.
 *
 * This scan fails the build when a source file outside the reviewed list below reads `patient_pregnancy` or `postnatal_profiles` with `.select(`.
 * Every entry is a surface where the reader IS the patient (their own row, their own session), so an empty result there is a real "none recorded".
 * Adding a file to the list is a review decision with a reason, not a way round the rule.
 */
const SRC = join(process.cwd(), "src");
const TABLES = ["patient_pregnancy", "postnatal_profiles"];

/** file (relative to src, forward slashes) -> why a direct read is acceptable there */
const REVIEWED_PATIENT_OWN_READS: Record<string, string> = {
  "app/(dashboard)/patient/pregnancy-status.tsx": "the patient's own pregnancy card, read in her own session",
  "app/(dashboard)/patient/(sections)/womens-health/page.tsx": "the patient's own Women's Health page, read in her own session",
  "lib/queries/womens-health.ts": "the patient's own antenatal, postnatal, breast and fertility lists",
  "lib/ai-coach/context.ts": "the patient's own AI coach context; a missing row is documented there as not assumed pregnant (a safety layer that errs the other way is tracked separately)",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * Files that read one of the two tables with .select( within 400 characters of the .from( call, or embed one in another table's select string
 * (for example `profiles.select("id, patient_pregnancy(is_pregnant)")`).
 */
function directReaders(): string[] {
  const names = TABLES.join("|");
  const direct = new RegExp(`from\\(\\s*["'\`](?:${names})["'\`]\\s*\\)[\\s\\S]{0,400}?\\.select\\(`);
  const embedded = new RegExp(`\\b(?:${names})\\s*(?:![a-z_]+)?\\(`);
  return walk(SRC)
    .filter((f) => {
      const text = readFileSync(f, "utf8");
      return direct.test(text) || (/\.select\(/.test(text) && embedded.test(text));
    })
    .map((f) => relative(SRC, f).split("\\").join("/"))
    .sort();
}

describe("direct pregnancy reads (OQ-555 follow-up)", () => {
  const readers = directReaders();

  it("the scan sees the reviewed readers (it is not vacuous)", () => {
    expect(readers.length).toBeGreaterThanOrEqual(Object.keys(REVIEWED_PATIENT_OWN_READS).length);
  });

  it("no unreviewed file reads patient_pregnancy or postnatal_profiles directly; use readPregnancySafety", () => {
    const unreviewed = readers.filter((f) => !(f in REVIEWED_PATIENT_OWN_READS));
    expect(unreviewed).toEqual([]);
  });

  it("the reviewed list has no stale entries", () => {
    const stale = Object.keys(REVIEWED_PATIENT_OWN_READS).filter((f) => !readers.includes(f));
    expect(stale).toEqual([]);
  });

  it("the five converted readers no longer read the tables", () => {
    for (const converted of [
      "app/(dashboard)/clinician/patients/[patientId]/page.tsx",
      "lib/clinical/patient-clinical-context.ts",
      "lib/care-changes/suggest-titration.ts",
      "lib/lowcarb/medicine-review.ts",
      "lib/queries/vitals.ts",
    ]) {
      expect(readers).not.toContain(converted);
    }
  });
});
