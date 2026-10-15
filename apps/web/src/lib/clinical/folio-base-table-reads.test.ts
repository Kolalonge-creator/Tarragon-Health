import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * CMO decision OQ-358 / OQ-358b. After the base-table lock (step 2) `authenticated` cannot select clinical_staff.credential_number,
 * and the folio prints on letters and prescriptions only. Keep both true at review time.
 */
const WEB_SRC = join(__dirname, "..", "..");
const MOBILE_SRC = join(__dirname, "..", "..", "..", "..", "mobile", "src");
const AUTH_SRC = join(__dirname, "..", "..", "..", "..", "..", "packages", "auth", "src");

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
const files = [...walk(WEB_SRC), ...walk(MOBILE_SRC), ...walk(AUTH_SRC)];

/** Only the folio reader itself may name the column in a select on the table. */
const ALLOWED_COLUMN_READERS = ["lib/clinical/staff-folio.ts"];

describe("no screen reads the folio from the clinical_staff base table", () => {
  it("no select on clinical_staff names credential_number, or asks for every column", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(WEB_SRC, file);
      if (ALLOWED_COLUMN_READERS.includes(rel)) continue;
      const src = readFileSync(file, "utf8");
      const direct = /from\(\s*["']clinical_staff["']\s*\)\s*\.select\(\s*([`"'])([^`"']*)\1/g;
      let m: RegExpExecArray | null;
      while ((m = direct.exec(src))) {
        if (m[2]!.includes("credential_number") || m[2]!.trim() === "*") offenders.push(`${rel}: ${m[2]}`);
      }
      const embed = /clinical_staff(?:![\w]+)?\(([^)]*)\)/g;
      while ((m = embed.exec(src))) {
        if (m[1]!.includes("credential_number") || m[1]!.trim() === "*") offenders.push(`${rel}: embed ${m[1]}`);
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
    expect(read("app/api/patient/referral/[referralId]/letter/route.ts")).toContain("folio.credentialNumber");
    expect(read("lib/prescriptions/load-prescription-pdf-data.ts")).toContain("credentialNumber");
  });
  it("patient-facing licence copy states a date, never a number", () => {
    const en = readFileSync(join(__dirname, "..", "..", "..", "..", "..", "packages", "i18n", "src", "en.ts"), "utf8");
    expect(en).toContain('"licence.line": "Licence verified on {date}"');
    expect(en).toContain('"book.card.licence_verified": "Licence verified on {date}"');
    expect(en).not.toContain("book.card.mdcn");
  });
});
