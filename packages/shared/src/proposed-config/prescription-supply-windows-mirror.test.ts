import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function migrationText(): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_t2_11c_patient_confirms_supply.sql"));
  if (!file) throw new Error("T2-11c migration not found");
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

function seededWindows(): Record<string, unknown> {
  const match = /rx-supply-windows-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(migrationText());
  if (!match?.[1]) throw new Error("prescription supply windows seed not found");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("prescriptions.patient_supply_windows mirrors the migration seed", () => {
  it("is identical, so the registry and prescription_supply_config cannot drift", () => {
    expect(seededWindows()).toEqual(getProposedConfig("prescriptions.patient_supply_windows").value);
  });

  it("is proposed and owned by the founder", () => {
    const e = getProposedConfig("prescriptions.patient_supply_windows");
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("Founder");
  });

  it("has every window as a positive whole number inside the database's own bounds", () => {
    const v = getProposedConfig("prescriptions.patient_supply_windows").value as Record<string, number>;
    expect(Object.keys(v).sort()).toEqual(["patient_duplicate_minutes", "patient_undo_hours", "report_match_days"]);
    for (const n of Object.values(v)) {
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThan(0);
    }
    expect(v.patient_undo_hours).toBeLessThanOrEqual(168);
    expect(v.report_match_days).toBeLessThanOrEqual(60);
    expect(v.patient_duplicate_minutes).toBeLessThanOrEqual(1440);
  });

  it("the functions read the windows from the config, not from literals", () => {
    const sql = migrationText();
    for (const key of ["patient_undo_hours", "report_match_days", "patient_duplicate_minutes"]) {
      expect(sql).toContain(`private.rx_supply_window('${key}')`);
    }
    expect(sql).not.toMatch(/interval '24 hours'|interval '7 days'/);
  });
});
