import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { en } from "@tarragon/i18n";
import { DOCUMENT_CAPTURE_TYPES } from "@tarragon/shared";

/**
 * "Unconfirmed values never feed escalation or risk" (S43, spec 2.3), as a repo scan for the phone, the same rule the web app already has
 * (apps/web/src/lib/document-capture/no-other-readers.test.ts). A reading is a suggestion that lives in the document's `extracted` and `ocr_text`
 * until the person confirms it, and confirmed values still are not clinical data. So nothing in the phone app outside the capture module may name
 * the documents table at all, and nothing outside it may name the reading columns: not triage, not risk, not a summary, not the offline mirror.
 * A new reader has to be added to the allow-list below on purpose, in a reviewed change, with the reason.
 */
const SRC = join(__dirname, "..", "..");
const ALLOWED_FOLDERS = [join("lib", "document-capture") + "/", join("screens", "sections", "documents") + "/"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC)
  .map((f) => ({ f, rel: relative(SRC, f) }))
  .filter(({ rel }) => !ALLOWED_FOLDERS.some((a) => rel.startsWith(a)))
  // This scan names the table in its own text.
  .filter(({ rel }) => !rel.endsWith("readers-scan.test.ts"));

describe("who may read photo-capture data on the phone", () => {
  it("nothing outside the capture module names the documents table", () => {
    const offenders = files.filter(({ f }) => /["'`]patient_documents["'`]/.test(readFileSync(f, "utf8"))).map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("nothing outside the capture module names the reading columns of a document", () => {
    const offenders = files.filter(({ f }) => /\bocr_text\b|\bocr_state\b|\bocr_model_id\b|\bocr_confirmed_at\b/.test(readFileSync(f, "utf8"))).map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("the allow-list is real: the capture module does read the table", () => {
    const hit = walk(join(SRC, "lib", "document-capture")).some((f) => /["'`]patient_documents["'`]/.test(readFileSync(f, "utf8")));
    expect(hit).toBe(true);
  });

  it("every document type, reading state and confidence the screens can show has words", () => {
    for (const t of DOCUMENT_CAPTURE_TYPES) expect(Object.hasOwn(en, `passport.documents.type.${t}`)).toBe(true);
    for (const s of ["confirmed", "failed", "rejected"]) expect(Object.hasOwn(en, `passport.documents.state.${s}`)).toBe(true);
    for (const c of ["low", "medium", "high"]) expect(Object.hasOwn(en, `passport.documents.confidence.${c}`)).toBe(true);
  });
});
