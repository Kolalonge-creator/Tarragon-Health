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
  // S48b: the phone's owner-only recorder store, the one deliberate widening (see the tests at the end of this file).
  /apps[\\/]mobile[\\/]src[\\/]lib[\\/]routes[\\/]route-store\.ts$/,
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

  it("S48b: only the owner-only route store names the table or the route column in the apps", () => {
    const named = files.filter((f) => /activity_routes|route_geojson/.test(readFileSync(f, "utf8"))).filter((f) => !ALLOWED.some((re) => re.test(f)));
    expect(named).toEqual([]);
    expect(files.filter((f) => /route-store\.ts$/.test(f))).toHaveLength(1);
  });

  it("S48b: the recorder, its store and its screen card have no share, export, map, link-out or send path", () => {
    const FORBIDDEN = /expo-sharing|react-native-maps|MapView|expo-file-system|Share\.share|Linking\.|openURL|fetch\(|navigator\.share|toGpx|exportRoute|shareRoute|postRoute|sendRoute|ShareLink/;
    const recorderFiles = files.filter(
      (f) => /apps[\\/]mobile[\\/]src[\\/]lib[\\/]routes[\\/][^\\/]+\.ts$/.test(f) || /movement-extras\.tsx$/.test(f),
    );
    // route-recorder, route-session, route-store, location-source, the stubbed-source test and the screen card
    expect(recorderFiles.length).toBeGreaterThanOrEqual(6);
    expect(recorderFiles.filter((f) => FORBIDDEN.test(readFileSync(f, "utf8")))).toEqual([]);
  });

  it("S48b: the route store only selects, inserts and deletes (the same three the database allows)", () => {
    const store = readFileSync(files.find((f) => /route-store\.ts$/.test(f)) as string, "utf8");
    expect(store).not.toMatch(/\.update\(|\.upsert\(/);
    expect((store.match(/from\("activity_routes"\)/g) ?? []).length).toBe(3);
  });
});
