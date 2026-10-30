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

describe("S70b configuration mirrors the migrations and stays PROPOSED", () => {
  it("bp.cuffless_calibration.cuffCheckWithinDays equals the days in the cuff-check task function", () => {
    const sql = migration("_s70b_cuffless_cuff_check_task.sql");
    const match = /cuffless_cuff_check_days\(\) returns integer[\s\S]*?select (\d+)/.exec(sql);
    expect(Number(match?.[1])).toBe((getProposedConfig("bp.cuffless_calibration").value as { cuffCheckWithinDays: number }).cuffCheckWithinDays);
  });

  it("pharmacy.reading_point equals private.pharmacy_reading_cfg()", () => {
    const sql = migration("_s70b_pharmacy_reading_point.sql");
    const match = /pharmacy_reading_cfg\(\)[\s\S]*?select '(\{[^']*\})'::jsonb/.exec(sql);
    expect(JSON.parse(match![1]!)).toEqual(getProposedConfig("pharmacy.reading_point").value);
  });

  it("all three entries are proposed and unsigned", () => {
    for (const key of ["bp.cuffless_calibration", "devices.connection_health", "pharmacy.reading_point"]) {
      expect(getProposedConfig(key).status).toBe("proposed");
    }
  });

  it("both new modules are created and neither migration switches anything on", () => {
    for (const [suffix, key] of [["_s70b_cuffless_cuff_check_task.sql", "device_cuffless_cuff_check_task"], ["_s70b_pharmacy_reading_point.sql", "device_pharmacy_readings"]] as const) {
      const sql = migration(suffix);
      expect(sql).toContain(`'${key}'`);
      expect(sql).not.toMatch(/is_enabled\s*=\s*true/i);
      expect(sql).not.toMatch(/function private\.go_live_conditions/);
    }
  });
});
