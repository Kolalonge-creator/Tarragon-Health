import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * CMO Q17 / OQ-358: public.clinical_staff_directory no longer carries credential_number. A read
 * of the view that asks for it would fail at runtime (undefined column), so keep it out at
 * review time too: no source file may select credential_number from the directory view.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.includes("database.types")) {
      out.push(full);
    }
  }
  return out;
}

describe("the staff directory view never carries the folio", () => {
  it("no source file selects credential_number from clinical_staff_directory", () => {
    const offenders: string[] = [];
    for (const file of [...walk(join(__dirname, "..", "..")), ...walk(join(__dirname, "..", "..", "..", "..", "mobile", "src"))]) {
      // REMOVE IN STEP 2: the deploy-window fallback is the one allowed reader while the column still exists.
      if (file.endsWith("lib/clinical/document-folio.ts")) continue;
      const src = readFileSync(file, "utf8");
      const re = /from\(\s*["']clinical_staff_directory["']\s*\)\s*\.select\(\s*([`"'])([^`"']*)\1/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        if (m[2]!.includes("credential_number") || m[2]!.trim() === "*") offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
