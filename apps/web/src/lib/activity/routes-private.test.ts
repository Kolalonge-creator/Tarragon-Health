import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * S48a / 5.7, acceptance "Routes are never shared": private route recording has NO share, export or read path in the codebase. The database
 * proof shows nobody but the owner can read a route; this scan shows no code anywhere even tries. If a later session adds route recording UI, this
 * test is where it must be consciously widened (and decision S48-1 re-read: emergency location is a separate feature).
 */
const REPO = join(__dirname, "..", "..", "..", "..", "..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", ".turbo", "coverage", ".expo", "reference", "tarragon-control", "docs"]);
const ALLOWED = [
  /database\.types\.ts$/,
  /supabase[\\/]migrations[\\/]/,
  /packages[\\/]db[\\/]tests[\\/]/,
  /routes-private\.test\.ts$/,
];

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs|json|sql)$/.test(name)) out.push(full);
  }
}

describe("private routes are never shared", () => {
  const files: string[] = [];
  for (const top of ["apps", "packages", "supabase"]) walk(join(REPO, top), files);

  it("no application or package code touches activity_routes", () => {
    const offenders = files.filter((f) => !ALLOWED.some((re) => re.test(f))).filter((f) => /activity_routes/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the migration defines no function that returns or exports a route", () => {
    const migration = files.find((f) => f.endsWith("_s48a_activity_safety_gate.sql"));
    expect(migration).toBeDefined();
    const sql = readFileSync(migration as string, "utf8");
    const routeTable = sql.slice(sql.indexOf("create table public.activity_routes"));
    expect(routeTable).not.toMatch(/create (or replace )?function[^;]*route/i);
    expect(sql).not.toMatch(/route_geojson[^;]*(share|export)/i);
    expect(sql).not.toMatch(/grant[^;]*update[^;]*activity_routes/i);
  });

  it("the patient export and the share sections list no route", () => {
    const hits = files.filter((f) => /record[-_]?share|export|fhir/i.test(f) && !ALLOWED.some((re) => re.test(f))).filter((f) => /route_geojson/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
