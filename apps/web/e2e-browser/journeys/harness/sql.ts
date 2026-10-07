// S85 journey harness: direct SQL against the LOCAL database through psql.
//
// Why psql and not supabase-js: seeding needs simulated sessions for RPCs that read auth.uid() and bulk inserts (a 300
// person cohort). It is the same tool the CI proof runner uses, so there is no new dependency.
// This is a SEEDING and OBSERVING channel only. Every assertion about what a person may see goes through a real signed-in
// session (see sessions.ts), because rows written or read here as the database owner prove nothing about access.

import { spawnSync } from "node:child_process";
import { journeyEnv } from "./env";

export function sql(text: string): string {
  const { dbUrl } = journeyEnv();
  const r = spawnSync("psql", [dbUrl, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-f", "-"], {
    input: text,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`psql failed (${r.status}): ${(r.stderr || r.error?.message || "").trim().slice(0, 1500)}`);
  }
  return r.stdout.trim();
}

/** Run a select and get its rows back as objects. */
export function sqlRows<T = Record<string, unknown>>(query: string): T[] {
  const out = sql(`select coalesce(json_agg(q_), '[]'::json) from (${query.replace(/;\s*$/, "")}) q_;`);
  return JSON.parse(out) as T[];
}

export function sqlValue<T = string>(query: string): T | null {
  const rows = sqlRows<Record<string, T>>(query);
  if (rows.length === 0) return null;
  const first = Object.values(rows[0]!)[0];
  return first ?? null;
}

/** Quote a literal for interpolation into a query string. */
export function lit(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}
