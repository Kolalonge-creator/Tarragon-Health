import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The Vercel crons are seeded into public.automations by the S80b migration. If vercel.json gains or loses a route, this fails until the registry is updated. */
describe("vercel.json and the automations seed", () => {
  const root = join(__dirname, "..", "..", "..");
  const crons: { path: string; schedule: string }[] = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")).crons;
  const migDir = join(root, "..", "..", "supabase", "migrations");
  const sql = readFileSync(join(migDir, "20261007204718_s80b_automations_registry.sql"), "utf8");

  it("seeds every vercel cron route with its schedule", () => {
    for (const c of crons) {
      expect(sql).toContain(`'vercel:${c.path.split("/").pop()}', 'vercel_cron', '${c.schedule}', '${c.path}'`);
    }
  });
  it("does not seed a route that vercel.json no longer has", () => {
    const seeded = [...sql.matchAll(/\('vercel:[^']+', 'vercel_cron', '[^']+', '([^']+)'\)/g)].map((m) => m[1]);
    expect(seeded.sort()).toEqual(crons.map((c) => c.path).sort());
  });
});
