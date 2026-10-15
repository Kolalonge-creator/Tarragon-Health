/**
 * Track G, spec 8.16 (OQ-320): a standing scan. What Tarragon PAYS a partner (lab_orders / pharmacy_orders.partner_cost_kobo and
 * partner_cost_breakdown) and what a refund costs it (lab_order_refunds / pharmacy_order_refunds.partner_portion_kobo and
 * margin_portion_kobo) are not readable by the database role patients, caregivers and clinicians use (column grant, migration
 * 20261007190500). This test makes sure no client code reaches for those columns, or for `select("*")` / an empty `select()` on those
 * four tables, so the next developer finds out at review time rather than as a production permission error.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";

const REPO = join(__dirname, "..", "..", "..", "..", "..");
const ROOTS = [
  "apps/web/src",
  "apps/mobile/src",
  "apps/mobile/app",
  "apps/console/src",
  "packages/shared/src",
  "packages/staff-core/src",
  "packages/ui/src",
  "supabase/functions",
];

const WITHHELD = ["partner_cost_kobo", "partner_cost_breakdown", "partner_portion_kobo", "margin_portion_kobo"];
const WITHHELD_RE = new RegExp(WITHHELD.join("|"));

/** Files that may name the withheld columns: the generated types, and the two query modules that name them only to Omit them. */
const ALLOWED = [
  "database.types.ts",
  `${sep}queries${sep}lab-orders.ts`,
  `${sep}queries${sep}pharmacy-orders.ts`,
  "partner-cost-columns.scan.test.ts",
];

const GUARDED_TABLES = ["lab_orders", "pharmacy_orders", "lab_order_refunds", "pharmacy_order_refunds"];

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
    const sel = /\.select\(/g;
    let sm: RegExpExecArray | null;
    while ((sm = sel.exec(stmt)) !== null) {
      let arg = balanced(stmt, sm.index + sm[0].length - 1);
      // A bare identifier is a constant: substitute its definition from the same file so `const X = "*, ..."` is caught too.
      const ident = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(arg);
      if (ident) {
        const def = new RegExp(`(?:const|let)\\s+${ident[1]}\\b[^=]*=\\s*([\\s\\S]{0,1200}?);`).exec(src);
        if (def) arg = def[1];
      }
      out.push(arg);
    }
  }
  return out;
}

/** Text between the "(" at `open` and its matching ")", so an embed like `panel_bundles(name)` cannot hide a trailing `*`. */
function balanced(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
}

/** Returns the embedded-select arguments of `table(...)` / `alias:table(...)` / `table!fk(...)` inside a select string. */
function embedArgs(src: string, table: string): string[] {
  const re = new RegExp(`\\b${table}(?:![a-z_]+)?\\(([^)]*)\\)`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

const isStar = (arg: string) => arg.trim() === "" || /["'`]\s*\*/.test(arg) || /,\s*\*/.test(arg) || /^\s*\*\s*$/.test(arg);

/** Row keys of a table in the generated Database type. */
function rowKeys(table: string): string[] {
  const src = readFileSync(join(REPO, "packages/shared/src/database.types.ts"), "utf8");
  const m = new RegExp(`\\n      ${table}: \\{\\n        Row: \\{([\\s\\S]*?)\\n        \\}`).exec(src);
  return [...(m?.[1] ?? "").matchAll(/\n {10}(\w+)\??:/g)].map((x) => x[1]);
}

/** The columns named by an exported `NAME = "a, b, c"` constant. */
function constCols(file: string, name: string): string[] {
  const m = new RegExp(`${name} =\\s*\\n?\\s*"([^"]+)"`).exec(readFileSync(join(REPO, file), "utf8"));
  return (m?.[1] ?? "").split(",").map((c) => c.trim()).filter(Boolean);
}

describe("8.16 partner cost and refund margin columns stay off the patient, caregiver and clinician surface", () => {
  it("scans a meaningful number of files", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("no client code or edge function names a withheld column", () => {
    const offenders = files
      .filter((f) => !ALLOWED.some((a) => f.includes(a)))
      .filter((f) => WITHHELD_RE.test(readFileSync(f, "utf8")))
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
          if (isStar(arg) || WITHHELD_RE.test(arg)) bad.push(`${relative(REPO, f)}: ${t}: ${arg.trim()}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("no embed of a guarded table selects * or a withheld column", () => {
    const bad: string[] = [];
    for (const f of files) {
      if (f.includes("database.types.ts") || /\.test\.tsx?$/.test(f)) continue;
      const src = readFileSync(f, "utf8");
      for (const t of GUARDED_TABLES) {
        for (const arg of embedArgs(src, t)) {
          if (/(^|,)\s*\*\s*($|,)/.test(arg) || WITHHELD_RE.test(arg)) bad.push(`${relative(REPO, f)}: ${t}(${arg.trim()})`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("the scan itself can fail: synthetic offending lines are detected", () => {
    expect(selectArgs(`supabase.from("pharmacy_orders").select("*")`, "pharmacy_orders").some(isStar)).toBe(true);
    expect(selectArgs(`supabase.from("lab_orders").select("id, partner_cost_kobo")`, "lab_orders").some((a) => WITHHELD_RE.test(a))).toBe(true);
    expect(embedArgs(`.select("id, order:lab_orders(*)")`, "lab_orders").some((a) => /(^|,)\s*\*\s*($|,)/.test(a))).toBe(true);
    expect(selectArgs(`supabase.from("lab_orders").select(LAB_ORDER_SAFE_COLUMNS)`, "lab_orders").some(isStar)).toBe(false);
    expect(selectArgs(`supabase\n  .from("lab_order_refunds")\n  // note\n  .select()`, "lab_order_refunds").some(isStar)).toBe(true);
    expect(selectArgs(`supabase.from("lab_orders").update({ a: 1 }).eq("id", x).select("*")`, "lab_orders").some(isStar)).toBe(true);
    expect(selectArgs(`supabase.from("lab_orders").select("id");\nsupabase.from("other").select("*")`, "lab_orders").some(isStar)).toBe(false);
    // a `*` hidden in a constant, and a `*` placed after an embed, are both caught
    expect(selectArgs(`const FOO_SELECT = "*, panel_bundle:panel_bundles(name)";\nsupabase.from("lab_orders").select(FOO_SELECT)`, "lab_orders").some(isStar)).toBe(true);
    expect(selectArgs(`supabase.from("lab_orders").select("id, panel_bundle:panel_bundles(name), *")`, "lab_orders").some(isStar)).toBe(true);
    expect(selectArgs("const OK = `${SAFE}, panel_bundle:panel_bundles(name)`;\nsupabase.from(\"lab_orders\").select(OK)", "lab_orders").some(isStar)).toBe(false);
  });

  it("the client safe-column lists are exactly the generated Row type minus the withheld columns (no drift)", () => {
    const pairs: [string, string, string][] = [
      ["lab_orders", "apps/web/src/lib/queries/lab-orders.ts", "LAB_ORDER_SAFE_COLUMNS"],
      ["pharmacy_orders", "apps/web/src/lib/queries/pharmacy-orders.ts", "PHARMACY_ORDER_SAFE_COLUMNS"],
    ];
    for (const [table, file, name] of pairs) {
      const keys = rowKeys(table);
      expect(keys.length).toBeGreaterThan(30);
      const expected = keys.filter((k) => !WITHHELD.includes(k)).sort();
      const actual = constCols(file, name).sort();
      expect({ file, cols: actual }).toEqual({ file, cols: expected });
      expect(actual.some((c) => WITHHELD.includes(c))).toBe(false);
    }
  });
});
