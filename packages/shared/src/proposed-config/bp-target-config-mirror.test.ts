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

describe("bp.target_config mirrors the migration seed (W-25, D-09)", () => {
  const sql = migration("_w25_measurement_context_target_config_stratified_view.sql");

  it("is identical to the bp_target_config version 1 seed", () => {
    const match = /bp-target-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("bp target config seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(getProposedConfig("bp.target_config").value);
    expect(getProposedConfig("bp.target_config").version).toBe(1);
  });

  it("ships unsigned and inactive, and stays PROPOSED", () => {
    expect(/values \(1, false, \$json\$/.test(sql)).toBe(true);
    const seedBlock = /bp-target-config-begin([\s\S]*?)bp-target-config-end/.exec(sql)![1]!;
    expect(seedBlock).not.toMatch(/approved_by|approved_at/);
    expect(getProposedConfig("bp.target_config").status).toBe("proposed");
  });

  it("carries the home 135/85 and clinic 140/90 lines, and the S75 140/90 default is not edited here", () => {
    const v = getProposedConfig("bp.target_config").value as { targets: { home: Record<string, number>; clinic: Record<string, number> } };
    expect(v.targets.home).toEqual({ systolic: 135, diastolic: 85 });
    expect(v.targets.clinic).toEqual({ systolic: 140, diastolic: 90 });
    // this migration does not redefine any S75 / cascade object
    expect(sql).not.toMatch(/create (or replace )?(function|view) [a-z_.]*(bp_control|v_bp_cohort|cascade_)/i);
    expect(sql).not.toMatch(/outcome_config|outcome_rule/);
  });

  it("has no signer: nothing in the migration can set approved_by", () => {
    expect(sql).not.toMatch(/function [a-z_.]*sign[a-z_]*\(/i);
    expect(sql).not.toMatch(/update public\.bp_target_config/i);
  });
});
