import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig, PROPOSED_CONFIG } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seedV3(): Record<string, unknown> {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s75_outcome_measures_hba1c_weight_phq9_gad7.sql"));
  if (!file) throw new Error("S75 migration not found");
  const text = readFileSync(join(MIGRATIONS, file), "utf8");
  const match = /outcome-rules-v3-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(text);
  if (!match?.[1]) throw new Error("outcome-rules-v3 seed not found");
  return JSON.parse(match[1]) as Record<string, unknown>;
}
function seedV4(): Record<string, unknown> {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s75_outcome_exclusions_and_bands.sql"));
  if (!file) throw new Error("S75 exclusions migration not found");
  const match = /outcome-rules-v4-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  if (!match?.[1]) throw new Error("outcome-rules-v4 seed not found");
  return JSON.parse(match[1]) as Record<string, unknown>;
}
const entry = (key: string, version: number) => PROPOSED_CONFIG.find((e) => e.key === key && e.version === version);

type Measure = Record<string, unknown>;

describe("outcome_config v3 (S75) mirrors the registry", () => {
  const seed = seedV3();
  const measureRules = entry("outcomes.measure_rules", 1)?.value as { bp_report_days: number[]; measures: Record<string, Measure> };
  const v2 = entry("outcomes.snapshot_rules", 2)?.value as Record<string, unknown>;

  it("v3 is exactly v2 plus the measure rules, so activating it changes no S38 rule", () => {
    expect(seed).toEqual({ ...v2, bp_report_days: measureRules.bp_report_days, measures: measureRules.measures });
  });

  it("the measure rules are PROPOSED and owned by the CMO, never signed in code", () => {
    const e = entry("outcomes.measure_rules", 1);
    expect(e?.status).toBe("proposed");
    expect(e?.owner).toBe("CMO");
  });

  it("v2 stays the version in force for the S38 rules (v3 is inactive until the CMO activates it)", () => {
    expect(getProposedConfig("outcomes.snapshot_rules").version).toBe(2);
    expect(entry("outcomes.snapshot_rules", 3)).toBeUndefined();
  });

  it("carries the CMO S-5 thresholds", () => {
    const m = measureRules.measures;
    expect(m.hba1c?.goal_below_percent).toBe(7.0);
    expect(m.hba1c?.use_care_plan_target).toBe(true);
    expect(m.weight?.goal_loss_percent).toBe(5);
    for (const code of ["phq9", "gad7"]) {
      expect(m[code]?.response_fall_percent).toBe(50);
      expect(m[code]?.remission_below).toBe(5);
    }
  });

  it("uses the S38 snapshot days only, and day 0 for every measure so a baseline exists", () => {
    const days = (v2 as { days: number[] }).days;
    for (const [code, m] of Object.entries(measureRules.measures)) {
      const own = m.days as number[];
      expect(own).toContain(0);
      for (const d of own) expect(days).toContain(d);
      expect(code.length).toBeGreaterThan(0);
    }
    expect(measureRules.bp_report_days).toEqual([90, 180]);
  });

  it("every measure states its definition and limitations, and none claims a cause", () => {
    for (const m of Object.values(measureRules.measures)) {
      expect(String(m.definition).length).toBeGreaterThan(20);
      expect(String(m.limitations)).toMatch(/comparison group|never shown to a sponsor|not a diagnosis/);
      expect(`${String(m.definition)} ${String(m.limitations)}`).not.toMatch(/\b(caused|cured|proves|because of the programme)\b/i);
    }
  });
});

describe("outcome_config v4 (S75 exclusions and bands) mirrors the registry", () => {
  const v2 = entry("outcomes.snapshot_rules", 2)?.value as Record<string, unknown>;
  const rules = entry("outcomes.measure_rules", 2)?.value as { bp_report_days: number[]; measures: Record<string, Record<string, unknown>> };

  it("v4 is exactly v2 plus the measure rules of registry version 2", () => {
    expect(seedV4()).toEqual({ ...v2, bp_report_days: rules.bp_report_days, measures: rules.measures });
  });

  it("v4 is v3 with only exclusions, bands and the limitations sentence added to each measure", () => {
    const v3 = entry("outcomes.measure_rules", 1)?.value as { measures: Record<string, Record<string, unknown>> };
    for (const [code, m] of Object.entries(rules.measures)) {
      const { exclusions, bands, limitations, ...rest } = m;
      const { limitations: l3, ...rest3 } = v3.measures[code] as Record<string, unknown>;
      expect(rest).toEqual(rest3);
      expect(exclusions).toBeDefined();
      expect(String(limitations).startsWith(String(l3))).toBe(true);
      expect(bands !== undefined).toBe(code === "phq9" || code === "gad7");
    }
  });

  it("excludes under 18 and unknown age everywhere, pregnancy for HbA1c and weight, and the PHQ-9 total-score safeguarding line for the two mental-health measures, with no crisis-flag read", () => {
    for (const m of Object.values(rules.measures)) {
      const e = m.exclusions as { min_age_years: number; age_required: boolean };
      expect(e.min_age_years).toBe(18);
      expect(e.age_required).toBe(true);
    }
    expect((rules.measures.hba1c!.exclusions as { pregnancy: boolean }).pregnancy).toBe(true);
    expect((rules.measures.weight!.exclusions as { pregnancy: boolean }).pregnancy).toBe(true);
    for (const code of ["phq9", "gad7"]) expect(JSON.stringify(rules.measures[code]!.exclusions)).not.toMatch(/crisis|item/);
    for (const code of ["phq9", "gad7"]) expect(rules.measures[code]!.exclusions).toMatchObject({ safeguarding: { score_from: 20 } });
  });

  it("is PROPOSED and owned by the CMO, and the bands cover every possible score exactly once", () => {
    const e = entry("outcomes.measure_rules", 2);
    expect(e?.status).toBe("proposed");
    expect(e?.owner).toBe("CMO");
    for (const [code, max] of [["phq9", 27], ["gad7", 21]] as const) {
      const bands = rules.measures[code]!.bands as [string, number, number][];
      let next = 0;
      for (const [, lo, hi] of bands) { expect(lo).toBe(next); next = hi + 1; }
      expect(next).toBe(max + 1);
    }
  });
});
