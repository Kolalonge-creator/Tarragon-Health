import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The Vercel crons are seeded into public.automations by the S80b migration. If vercel.json gains or loses a route, this fails until the registry is updated. */
describe("vercel.json and the automations seed", () => {
  const root = join(__dirname, "..", "..", "..");
  const crons: { path: string; schedule: string }[] = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")).crons;
  const migDir = join(root, "..", "..", "supabase", "migrations");
  // S80b seeded the crons that existed then; a later migration seeds the ones other builds added since. Applied migrations are never edited, so a cron added after them registers itself in its own migration; all of these files together are the seed.
  const sql = ["20261007204718_s80b_automations_registry.sql", "20261016004217_s80b_seed_vercel_crons_added_since.sql", "20261022093328_learning_expiry_backlog.sql"]
    .map((f) => readFileSync(join(migDir, f), "utf8"))
    .join("\n");

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
