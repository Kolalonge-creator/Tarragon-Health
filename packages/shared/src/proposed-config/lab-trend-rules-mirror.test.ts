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

describe("lab.trend_rules mirrors the migration seed (T2 Phase 2)", () => {
  const sql = migration("_t2_phase2_lab_trend_rules_and_health_status.sql");

  it("is identical to the lab_trend_rule_sets version 1 seed", () => {
    const match = /lab-trend-rules-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("lab trend rules seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(getProposedConfig("lab.trend_rules").value);
    expect(getProposedConfig("lab.trend_rules").version).toBe(1);
  });

  it("ships unsigned and inactive, and stays PROPOSED", () => {
    const seedBlock = /lab-trend-rules-begin([\s\S]*?)lab-trend-rules-end/.exec(sql)![1]!;
    expect(seedBlock).toMatch(/values \(1, false, \$json\$/);
    expect(seedBlock).not.toMatch(/approved_by|approved_at/);
    expect(getProposedConfig("lab.trend_rules").status).toBe("proposed");
  });

  it("names its review window by escalation pathway, never by minutes", () => {
    const v = getProposedConfig("lab.trend_rules").value as { review: Record<string, string> };
    expect(Object.keys(v.review).sort()).toEqual(["alert_level", "sla_pathway", "sla_tier"]);
    expect(JSON.stringify(v)).not.toMatch(/minutes/i);
  });
});
