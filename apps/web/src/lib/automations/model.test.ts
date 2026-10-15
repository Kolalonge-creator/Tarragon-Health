import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pauseState, type AutomationRow } from "./model";

const row = (o: Partial<AutomationRow>): AutomationRow => ({
  job_name: "j", purpose: null, owner: "unassigned", schedule: "* * * * *", source: "pg_cron", safety_critical: false,
  is_paused: false, paused_at: null, reason: null, last_run_at: null, last_status: null, registered: true, ...o,
});

describe("pauseState", () => {
  it("offers a pause only for a registered, routine pg_cron job", () => {
    expect(pauseState(row({}))).toBe("can_pause");
    expect(pauseState(row({ safety_critical: true }))).toBe("safety_critical");
    expect(pauseState(row({ source: "vercel" }))).toBe("vercel");
    expect(pauseState(row({ registered: false }))).toBe("unregistered");
    expect(pauseState(row({ is_paused: true }))).toBe("paused");
  });
});

describe("the registry migration lists exactly the crons in vercel.json", () => {
  const root = join(__dirname, "..", "..", "..");
  const paths = (JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as { crons: { path: string }[] }).crons.map((c) => c.path).sort();
  const dir = join(root, "..", "..", "supabase", "migrations");
  const file = readdirSync(dir).find((f) => f.endsWith("_s80_automations_registry.sql"));
  it("finds the migration", () => expect(file).toBeDefined());
  it("has the same set", () => {
    const sql = readFileSync(join(dir, file as string), "utf8");
    const block = sql.slice(sql.indexOf("select v.job_name, v.schedule, 'vercel'"), sql.indexOf("-- vercel-crons-end"));
    const listed = [...block.matchAll(/'(\/api\/cron\/[a-z0-9-]+)'/g)].map((m) => m[1]).sort();
    expect(listed).toEqual(paths);
  });
});
