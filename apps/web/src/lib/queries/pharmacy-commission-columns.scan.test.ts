/**
 * S53 pre-fix, spec 8.16: a standing scan. The commission columns (commission_rate, commission_rate_type, commission_flat_kobo)
 * are not readable by the database role patients, clinicians and pharmacists use (column grant, migration
 * 20261007210001). This test makes sure no client code reaches for them, or for `select("*")`, outside the finance and admin
 * surfaces, so the next developer finds out at review time rather than as a production permission error.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";

const REPO = join(__dirname, "..", "..", "..", "..", "..");
const ROOTS = ["apps/web/src", "apps/mobile/src", "apps/mobile/app", "apps/console/src", "packages/shared/src", "packages/staff-core/src", "packages/ui/src"];

/** Files and folders that are allowed to name the commission columns: admin and finance code, the generated types, tests. */
const ALLOWED = [
  "database.types.ts",
  `${sep}admin${sep}`,
  `${sep}finance${sep}`,
  "commission-rate-editor.tsx",
  `${sep}queries${sep}partner-catalogues.ts`,
  `${sep}queries${sep}commissions.ts`,
  `${sep}queries${sep}pharmacy-orders.ts`, // names the columns only to Omit them from the patient type
  "pharmacy-commission-columns.scan.test.ts",
  "packages/shared/src/index.ts",
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(join(REPO, r)));

describe("8.16 commission columns stay off the patient, clinician and pharmacist surface", () => {
  it("scans a meaningful number of files", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("no client code outside admin and finance names a pharmacy commission column", () => {
    const offenders = files
      .filter((f) => !ALLOWED.some((a) => f.includes(a)))
      .filter((f) => /commission_rate|commission_flat_kobo/.test(readFileSync(f, "utf8")))
      .map((f) => relative(REPO, f));
    expect(offenders).toEqual([]);
  });

  it("every read of pharmacy_medications names its columns and never selects *", () => {
    const bad: string[] = [];
    for (const f of files) {
      if (f.includes("database.types.ts") || f.endsWith(".test.ts") || f.endsWith(".test.tsx")) continue;
      const src = readFileSync(f, "utf8");
      const re = /\.from\(\s*["']pharmacy_medications["']\s*\)\s*\.select\(\s*([^)]*)\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const arg = m[1];
        if (/["'`]\s*\*/.test(arg) || /,\s*\*/.test(arg) || /commission/.test(arg)) bad.push(`${relative(REPO, f)}: ${arg.trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the scan itself can fail: a synthetic offending line is detected", () => {
    const re = /\.from\(\s*["']pharmacy_medications["']\s*\)\s*\.select\(\s*([^)]*)\)/g;
    const m = re.exec(`supabase.from("pharmacy_medications").select("*")`);
    expect(m && /["'`]\s*\*/.test(m[1])).toBeTruthy();
  });
});
