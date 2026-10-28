import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig, PROPOSED_CONFIG } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

type Baseline = {
  freshness_months: number;
  tests_due_days: number;
  egfr: { metformin_do_not_start_below: number; metformin_review_dose_below: number };
  pregnancy: { classes: string[]; age_from: number; age_to: number; negative_test_valid_days: number };
  classes: Record<string, { label: string; requires: string[] }>;
};

describe("prescribing.baseline_labs_rule mirrors the migration seed", () => {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_baseline_labs_prescribing_check.sql"));
  if (!file) throw new Error("baseline labs migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const cfg = getProposedConfig<Baseline>("prescribing.baseline_labs_rule");

  it("is identical to the baseline_labs_config v1 seed", () => {
    const match = /baseline-labs-v1-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("baseline labs seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(cfg.value);
  });

  it("is PROPOSED and owned by the CMO, never signed in code", () => {
    const e = PROPOSED_CONFIG.find((x) => x.key === "prescribing.baseline_labs_rule");
    expect(e?.status).toBe("proposed");
    expect(e?.owner).toBe("CMO");
  });

  it("the migration seeds it unsigned and inactive and nothing in the seed signs", () => {
    expect(sql).toMatch(/values \(1, false, '2026-10-28'/);
    const seedPart = sql.slice(sql.indexOf("baseline-labs-v1-begin"), sql.indexOf("baseline-labs-v1-end"));
    expect(seedPart).not.toMatch(/approved_at|is_active\s*=\s*true/);
  });

  it("carries the CMO's answers: the drafted thresholds, and a calcium channel blocker alone needs no test", () => {
    expect(cfg.value.freshness_months).toBe(12);
    expect(cfg.value.tests_due_days).toBe(7);
    expect(cfg.value.egfr).toEqual({ metformin_do_not_start_below: 30, metformin_review_dose_below: 45 });
    expect(cfg.value.classes["ccb"]?.requires).toEqual([]);
    expect(cfg.value.classes["acei"]?.requires).toEqual(["creatinine", "potassium", "sodium"]);
    expect(cfg.value.classes["metformin"]?.requires).toEqual(["creatinine", "glucose_or_hba1c"]);
    expect(cfg.value.pregnancy.classes).toEqual(["acei", "arb", "statin"]);
  });
});
