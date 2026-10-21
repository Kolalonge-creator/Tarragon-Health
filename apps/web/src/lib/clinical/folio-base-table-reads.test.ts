import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * CMO decision OQ-358 / OQ-358b. After the base-table lock (step 2) `authenticated` cannot select clinical_staff.credential_number,
 * and the folio prints on letters and prescriptions only. Keep both true at review time.
 */
const WEB_SRC = join(__dirname, "..", "..");
const MOBILE_SRC = join(__dirname, "..", "..", "..", "..", "mobile", "src");
const PACKAGES = join(__dirname, "..", "..", "..", "..", "..", "packages");
const CONSOLE_SRC = join(__dirname, "..", "..", "..", "..", "console", "src");
const EDGE_FUNCTIONS = join(__dirname, "..", "..", "..", "..", "..", "supabase", "functions");
const exists = (d: string) => { try { return statSync(d).isDirectory(); } catch { return false; } };

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.includes("database.types")) out.push(full);
  }
  return out;
}
const packageSrcs = readdirSync(PACKAGES).map((p) => join(PACKAGES, p, "src")).filter(exists);
const files = [...walk(WEB_SRC), ...walk(MOBILE_SRC), ...(exists(CONSOLE_SRC) ? walk(CONSOLE_SRC) : []), ...packageSrcs.flatMap((d) => walk(d)), ...(exists(EDGE_FUNCTIONS) ? walk(EDGE_FUNCTIONS) : [])];

/** Only the folio reader itself may name the column in a select on the table. */
const ALLOWED_COLUMN_READERS = ["lib/clinical/staff-folio.ts"];
/** A column list that fails once the table grant is column-scoped: names the folio, or is "*" (alone or leading), or is empty (= "*"). */
const asksForFolio = (cols: string) => cols.includes("credential_number") || /^\s*\*/.test(cols) || cols.trim() === "";

describe("no screen reads the folio from the clinical_staff base table", () => {
  it("no select on clinical_staff names credential_number, or asks for every column", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(WEB_SRC, file);
      if (ALLOWED_COLUMN_READERS.includes(rel)) continue;
      const src = readFileSync(file, "utf8");
      // select("...") with a literal, or select() with nothing, directly after from("clinical_staff")
      const direct = /from\(\s*["']clinical_staff["']\s*\)\s*\.select\(\s*(?:([`"'])([^`"']*)\1)?\s*[,)]/g;
      let m: RegExpExecArray | null;
      while ((m = direct.exec(src))) {
        if (asksForFolio(m[2] ?? "")) offenders.push(`${rel}: select(${m[2] ?? ""})`);
      }
      // a write whose RETURNING needs column SELECT (insert/update/upsert ... .select())
      const returning = /from\(\s*["']clinical_staff["']\s*\)\s*\.(?:insert|update|upsert)\([\s\S]{0,600}?\)\s*\.select\(/g;
      while ((m = returning.exec(src))) offenders.push(`${rel}: write with .select()`);
      // an embed of the table: take its column list up to the matching close, however it nests
      const embedStart = /clinical_staff(?:![\w]+)?\(/g;
      while ((m = embedStart.exec(src))) {
        let depth = 1;
        let i = m.index + m[0].length;
        const from = i;
        while (i < src.length && depth > 0) {
          if (src[i] === "(") depth++;
          else if (src[i] === ")") depth--;
          i++;
        }
        const cols = src.slice(from, i - 1);
        if (/^[^`"']*$/.test(cols) && (cols.includes("credential_number") || /^\s*\*/.test(cols))) offenders.push(`${rel}: embed ${cols}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the folio prints on letters and prescriptions only (OQ-358b)", () => {
  const read = (p: string) => readFileSync(join(WEB_SRC, p), "utf8");
  it("lab result and verified-document PDFs carry no folio, only 'Licence verified on <date>'", () => {
    for (const p of [
      "lib/lab-results/interpretation-document.tsx",
      "lib/verified-documents/verified-document.tsx",
      "app/api/patient/lab-result/[documentId]/pdf/route.ts",
      "app/api/patient/lab-result/combined/pdf/route.ts",
      "app/api/patient/verified-documents/[id]/pdf/route.ts",
      "app/api/mobile/verified-documents/[id]/pdf/route.ts",
    ]) {
      const src = read(p);
      expect(src).not.toMatch(/credentialNumber|credential_number|issuerCredential\b|doctorCredential/);
      expect(src).toContain("icence");
    }
  });
  it("referral letters and prescriptions still carry it", () => {
    // The letter's body lives in one shared renderer used by both the cookie route and the native bearer route.
    expect(read("lib/referrals/render-referral-letter.ts")).toContain("folio.credentialNumber");
    expect(read("lib/prescriptions/load-prescription-pdf-data.ts")).toContain("credentialNumber");
  });
  it("patient-facing licence copy states a date, never a number", () => {
    const en = readFileSync(join(__dirname, "..", "..", "..", "..", "..", "packages", "i18n", "src", "en.ts"), "utf8");
    expect(en).toContain('"licence.line": "Licence verified on {date}"');
    expect(en).toContain('"book.card.licence_verified": "Licence verified on {date}"');
    expect(en).not.toContain("book.card.mdcn");
  });
});
