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
    report_round_to: number;
    usage_report_enabled: boolean;
  };
  const sql = migration("_employer_seat_pilot_kit.sql");

  it("the seeded rules are identical to the registry", () => {
    const match = /employer-seat-pilot-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("pilot config seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(cfg);
  });

  it("holds no minimum cell of its own: the report uses the one platform rule (S75a), so there is a single number to change (I9)", () => {
    expect(JSON.stringify(cfg).toLowerCase()).not.toMatch(/min_cell|floor|min_group/);
    expect(sql).toMatch(/private\.min_cell_floor\(/);
    expect(sql).toMatch(/private\.suppress_cell\(/);
    expect(sql).not.toMatch(/min_cohort_size\)?\s*,\s*5|greatest\(coalesce\(\(select min_cohort_size/);
  });

  it("ships with usage reporting OFF until counsel and the DPO sign the employee notice", () => {
    expect(cfg.usage_report_enabled).toBe(false);
  });

  it("holds no price: a pilot seat is priced at the organisation price in force", () => {
    expect(JSON.stringify(cfg).toLowerCase()).not.toMatch(/kobo|price|naira/);
  });

  it("creates no wallet or balance table (INV-09)", () => {
    expect(sql.toLowerCase()).not.toMatch(/create table[^;]*(wallet|balance)/);
  });
});
