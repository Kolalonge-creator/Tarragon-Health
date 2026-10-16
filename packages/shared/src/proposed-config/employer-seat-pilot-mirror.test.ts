import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function migration(suffix: string): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`${suffix} not found`);
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

describe("the employer seat pilot config mirrors the migration", () => {
  const cfg = getProposedConfig("employer.seat_pilot").value as {
    max_seats_per_pilot: number;
    max_window_days: number;
    report_min_cell_floor: number;
    report_round_to: number;
  };
  const sql = migration("_employer_seat_pilot_kit.sql");

  it("the seeded rules are identical to the registry", () => {
    const match = /employer-seat-pilot-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("pilot config seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(cfg);
  });

  it("the report floor is never below 5, the same floor the organisation threshold has (I9)", () => {
    expect(cfg.report_min_cell_floor).toBeGreaterThanOrEqual(5);
  });

  it("holds no price: a pilot seat is priced at the organisation price in force", () => {
    expect(JSON.stringify(cfg).toLowerCase()).not.toMatch(/kobo|price|naira/);
  });

  it("creates no wallet or balance table (INV-09)", () => {
    expect(sql.toLowerCase()).not.toMatch(/create table[^;]*(wallet|balance)/);
  });
});
