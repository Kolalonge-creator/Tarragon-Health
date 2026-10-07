/**
 * Track E, spec 8.16: a standing scan. The commission columns on lab_tests, panel_bundles, screen_types and therapy_sessions
 * (commission_rate, commission_rate_type, commission_flat_kobo, commission_kobo) are not readable by the database role patients,
 * clinicians and partners use (column grant, migration 20261007105817). This test makes sure no client code reaches for them, or
 * for `select("*")` on those four tables, outside the admin and finance surfaces, so the next developer finds out at review time
 * rather than as a production permission error.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";

const REPO = join(__dirname, "..", "..", "..", "..", "..");
const ROOTS = ["apps/web/src", "apps/mobile/src", "apps/mobile/app", "apps/console/src", "packages/shared/src", "packages/staff-core/src", "packages/ui/src"];

/** Files and folders that may name the commission columns: admin and finance code, the generated types, tests. */
const ALLOWED = [
  "database.types.ts",
  `${sep}admin${sep}`,
  `${sep}finance${sep}`,
  "commission-rate-editor.tsx",
  `${sep}queries${sep}partner-catalogues.ts`,
  `${sep}queries${sep}commissions.ts`,
  `${sep}queries${sep}pharmacy-orders.ts`,
  `${sep}queries${sep}lab-orders.ts`, // names the columns only to Omit them from the patient type
  `${sep}queries${sep}lab-partner.ts`, // same
  `${sep}queries${sep}therapy.ts`, // same
  `${sep}lib${sep}labs.ts`, // mobile: same
  `${sep}lib${sep}therapy.ts`, // mobile: same
  "lab-commission-columns.scan.test.ts",
  "pharmacy-commission-columns.scan.test.ts",
  "packages/shared/src/index.ts",
];

const GUARDED_TABLES = ["lab_tests", "panel_bundles", "screen_types", "therapy_sessions"];

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

/**
 * Returns the argument text of every `.select(...)` in the statement that starts at `.from("<table>")` (up to the next `;`, the next
 * `.from(`, or 900 characters). Handles a line break or comment between `.from()` and `.select()`, an empty `.select()` (which
 * defaults to `*`), and `.insert()/.update()` followed by `.select()` (RETURNING needs SELECT on every returned column).
 */
function selectArgs(src: string, table: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\.from\\(\\s*["']${table}["']\\s*\\)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const rest = src.slice(m.index + m[0].length, m.index + m[0].length + 900);
    const stop = rest.search(/;|\.from\(/);
    const stmt = stop === -1 ? rest : rest.slice(0, stop);
    const sel = /\.select\(\s*([^)]*)\)/g;
    let sm: RegExpExecArray | null;
    while ((sm = sel.exec(stmt)) !== null) out.push(sm[1]);
  }
  return out;
}

/** Returns the embedded-select arguments of `table(...)` / `alias:table(...)` inside a select string. */
function embedArgs(src: string, table: string): string[] {
  const re = new RegExp(`\\b${table}(?:![a-z_]+)?\\(([^)]*)\\)`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

const isStar = (arg: string) => arg.trim() === "" || /["'`]\s*\*/.test(arg) || /,\s*\*/.test(arg) || /^\s*\*\s*$/.test(arg);

/** Admin-only reads allowed to select * from a guarded table (the ship-code-first fallback in the admin catalogue). */
const STAR_ALLOWED = [`${sep}queries${sep}partner-catalogues.ts`];

describe("8.16 lab, screening and therapy commission columns stay off the patient, clinician and partner surface", () => {
  it("scans a meaningful number of files", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("no client code outside admin and finance names a commission column", () => {
    const offenders = files
      .filter((f) => !ALLOWED.some((a) => f.includes(a)))
      .filter((f) => /commission_rate|commission_flat_kobo|commission_kobo/.test(readFileSync(f, "utf8")))
      .map((f) => relative(REPO, f));
    expect(offenders).toEqual([]);
  });

  it("every direct read of the guarded tables names its columns and never selects *", () => {
    const bad: string[] = [];
    for (const f of files) {
      if (f.includes("database.types.ts") || /\.test\.tsx?$/.test(f)) continue;
      const src = readFileSync(f, "utf8");
      for (const t of GUARDED_TABLES) {
        for (const arg of selectArgs(src, t)) {
          if (STAR_ALLOWED.some((a) => f.includes(a)) && !/commission/.test(arg)) continue;
          if (isStar(arg) || /commission/.test(arg)) bad.push(`${relative(REPO, f)}: ${t}: ${arg.trim()}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("no embed of a guarded table selects * or a commission column", () => {
    const bad: string[] = [];
    for (const f of files) {
      if (f.includes("database.types.ts") || /\.test\.tsx?$/.test(f)) continue;
      const src = readFileSync(f, "utf8");
      for (const t of GUARDED_TABLES) {
        for (const arg of embedArgs(src, t)) {
          if (/(^|,)\s*\*\s*($|,)/.test(arg) || /commission/.test(arg)) bad.push(`${relative(REPO, f)}: ${t}(${arg.trim()})`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("the scan itself can fail: synthetic offending lines are detected", () => {
    expect(selectArgs(`supabase.from("panel_bundles").select("*")`, "panel_bundles").some(isStar)).toBe(true);
    expect(selectArgs(`supabase.from("lab_tests").select("id, commission_rate")`, "lab_tests").some((a) => /commission/.test(a))).toBe(true);
    expect(embedArgs(`.select("id, screen_type:screen_types(*)")`, "screen_types").some((a) => /(^|,)\s*\*\s*($|,)/.test(a))).toBe(true);
    expect(selectArgs(`supabase.from("panel_bundles").select(SAFE_COLUMNS)`, "panel_bundles").some(isStar)).toBe(false);
    expect(selectArgs(`supabase\n  .from("panel_bundles")\n  // note\n  .select()`, "panel_bundles").some(isStar)).toBe(true);
    expect(selectArgs(`supabase.from("therapy_sessions").update({ a: 1 }).eq("id", x).select("*")`, "therapy_sessions").some(isStar)).toBe(true);
    expect(selectArgs(`supabase.from("lab_tests").select("id");\nsupabase.from("other").select("*")`, "lab_tests").some(isStar)).toBe(false);
  });

  it("the client safe-column lists equal the migration's column grants (no drift)", () => {
    const mig = readFileSync(
      join(REPO, "supabase/migrations/20261007105817_e_lab_screen_therapy_commission_columns_off_the_authenticated_surface.sql"),
      "utf8",
    );
    const grantCols = (table: string) => {
      const m = new RegExp(`grant select \\(([^)]*)\\) on public\\.${table} to authenticated`).exec(mig);
      return (m?.[1] ?? "").split(",").map((c) => c.trim()).filter(Boolean).sort();
    };
    const constCols = (file: string, name: string) => {
      const m = new RegExp(`${name} =\\s*"([^"]+)"`).exec(readFileSync(join(REPO, file), "utf8"));
      return (m?.[1] ?? "").split(",").map((c) => c.trim()).filter(Boolean).sort();
    };
    const pairs: [string, string, string][] = [
      ["panel_bundles", "apps/web/src/lib/queries/lab-orders.ts", "PANEL_BUNDLE_SAFE_COLUMNS"],
      ["panel_bundles", "apps/mobile/src/lib/labs.ts", "PANEL_BUNDLE_SAFE_COLUMNS"],
      ["lab_tests", "apps/web/src/lib/queries/lab-partner.ts", "LAB_TEST_SAFE_COLUMNS"],
      ["therapy_sessions", "apps/web/src/lib/queries/therapy.ts", "THERAPY_SESSION_SAFE_COLUMNS"],
      ["therapy_sessions", "apps/mobile/src/lib/therapy.ts", "THERAPY_SESSION_SAFE_COLUMNS"],
    ];
    for (const [table, file, name] of pairs) {
      expect(grantCols(table).length).toBeGreaterThan(5);
      expect({ file, cols: constCols(file, name) }).toEqual({ file, cols: grantCols(table) });
    }
  });
});
