import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function migration(suffix: string): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`migration ending ${suffix} not found`);
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

describe("bp.home_programme mirrors the migration seed (S07x)", () => {
  const sql = migration("_s07x_home_bp_programme.sql");

  it("is identical to the home_bp_programme_signoffs version 1 seed", () => {
    const match = /home-bp-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("home BP config seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(getProposedConfig("bp.home_programme").value);
    expect(getProposedConfig("bp.home_programme").version).toBe(1);
  });

  it("ships unsigned and inactive: the seed row is inserted with is_active false and no approver", () => {
    expect(/values \(1, false, \$json\$/.test(sql)).toBe(true);
    const seedBlock = /home-bp-config-begin([\s\S]*?)home-bp-config-end/.exec(sql)![1]!;
    expect(seedBlock).not.toMatch(/approved_by|approved_at/);
    expect(getProposedConfig("bp.home_programme").status).toBe("proposed");
  });

  it("keeps the numbers the CMO approved on 2026-10-07 (C1, C2, C3)", () => {
    const v = getProposedConfig("bp.home_programme").value as {
      protocol: Record<string, unknown>;
      bands: Record<string, number>;
      pattern: Record<string, number>;
    };
    expect(v.protocol).toMatchObject({ readingsPerSession: 2, minGapMinutes: 1, targetDays: 7, minDays: 3, minReadings: 12, restMinutes: 5, avoidBeforeMinutes: 30 });
    expect(v.bands).toEqual({ aboveSystolic: 135, aboveDiastolic: 85, borderlineSystolic: 130, borderlineDiastolic: 80 });
    expect(v.pattern).toEqual({ clinicSystolic: 140, clinicDiastolic: 90, windowDays: 30 });
  });

  it("the task types and both go-live guards are created, and both guards are born off", () => {
    expect(sql).toContain("'home_bp_check_review', 1, 8, 2880");
    expect(sql).toContain("'bp_pattern_review', 1, 8, 2880");
    expect(sql).toMatch(/\('home_bp_programme',[\s\S]*?\n\s+\('bp_pattern_flag'/);
    // the guard table's is_on defaults to false and the insert does not name it
    expect(sql).not.toMatch(/insert into public\.go_live_guards \([^)]*is_on/);
  });
});
