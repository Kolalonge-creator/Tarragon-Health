import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * "Unconfirmed values never feed escalation or risk" (S43, spec 2.3), as a
 * repo scan. The suggestions live in patient_documents.extracted and ocr_text
 * until the patient confirms them, and confirmed values still are not clinical
 * data. So nothing in the web app outside the capture module and its own
 * screen may read the patient_documents table at all: not the triage engine,
 * not risk scoring, not escalation, not a summary. A new reader has to be added
 * to the allow-list below on purpose, in a reviewed change.
 */

const SRC = join(__dirname, "..", "..");
const ALLOWED = [
  join("lib", "document-capture") + "/",
  join("app", "(dashboard)", "patient", "documents") + "/",
];
// Exactly one file is allowed by name. S44's item-note.tsx lists "patient_documents" in a Set of table names a note may be attached to; it
// builds no query and reads no row of that table. Allowing the one file (not its folder) keeps the guard strict for every other file.
const ALLOWED_FILES = [join("components", "item-note.tsx")];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("patient_documents readers", () => {
  it("are limited to the capture module and the documents screen", () => {
    const offenders = walk(SRC)
      .map((f) => ({ f, rel: relative(SRC, f) }))
      .filter(({ rel }) => !ALLOWED.some((a) => rel.startsWith(a)))
      .filter(({ rel }) => !ALLOWED_FILES.includes(rel))
      .filter(({ f }) => /["'`]patient_documents["'`]/.test(readFileSync(f, "utf8")))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("the named exception is real, is one file, and queries nothing", () => {
    const src = readFileSync(join(SRC, ALLOWED_FILES[0]), "utf8");
    expect(ALLOWED_FILES).toHaveLength(1);
    expect(/["'`]patient_documents["'`]/.test(src)).toBe(true);
    expect(/\.from\(\s*["'`]patient_documents["'`]/.test(src)).toBe(false);
  });

  it("the allow-list is real (the capture module does read the table)", () => {
    const hit = walk(join(SRC, "lib", "document-capture")).some((f) => /["'`]patient_documents["'`]/.test(readFileSync(f, "utf8")));
    expect(hit).toBe(true);
  });
});
