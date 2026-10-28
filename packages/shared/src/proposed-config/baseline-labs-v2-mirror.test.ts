import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig, PROPOSED_CONFIG } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

type Req = { key: string; label: string; name_patterns: string[]; requires: string[] };
type Rule = {
  drug_classes: { bp_lowering: { name_patterns: string[] } };
  class_requirements: Req[];
  recency_window_days: number;
  egfr_rules: { name_patterns: string[]; do_not_start_below: number; review_dose_below: number };
  pregnancy: { classes: string[]; age_from: number; age_to: number; negative_test_valid_days: number };
  when_labs_are_missing: { override: { followup_hours: number } };
};

describe("prescribing.baseline_labs_rule_v2 mirrors the migration seed (CMO answers 2026-10-27)", () => {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_baseline_labs_rule_v2_cmo_answers.sql"));
  if (!file) throw new Error("baseline labs v2 migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const cfg = getProposedConfig<Rule>("prescribing.baseline_labs_rule", "2026-10-28");   // the newest version in force is v2

  it("is identical to the baseline_labs_rule_config v2 seed", () => {
    const match = /baseline-labs-rule-v2-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("v2 seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(cfg.value);
  });

  it("is PROPOSED and owned by the CMO, never signed in code", () => {
    const e = PROPOSED_CONFIG.find((x) => x.key === "prescribing.baseline_labs_rule" && x.version === 2);
    expect(e?.status).toBe("proposed");
    expect(e?.owner).toBe("CMO");
    expect(e?.version).toBe(2);
  });

  it("the migration seeds v2 unsigned and inactive and nothing in the seed signs", () => {
    expect(sql).toMatch(/values \(2, false, '2026-10-28'/);
    const seedPart = sql.slice(sql.indexOf("baseline-labs-rule-v2-begin"), sql.indexOf("baseline-labs-rule-v2-end"));
    expect(seedPart).not.toMatch(/approved_at|is_active\s*=\s*true/);
  });

  it("carries the CMO's answers: 12 months, 7-day follow-up, kidney limits 30 and 45, pregnancy for ACE inhibitor / ARB / statin", () => {
    expect(cfg.value.recency_window_days).toBe(365);
    expect(cfg.value.when_labs_are_missing.override.followup_hours).toBe(168);
    expect(cfg.value.egfr_rules).toMatchObject({ do_not_start_below: 30, review_dose_below: 45, name_patterns: ["%metformin%"] });
    expect(cfg.value.pregnancy).toMatchObject({ classes: ["acei_arb", "statin"], age_from: 12, age_to: 50, negative_test_valid_days: 30 });
  });

  it("a calcium channel blocker or a beta blocker alone is out of scope, and no class requires a test for them", () => {
    const all = [...cfg.value.drug_classes.bp_lowering.name_patterns, ...cfg.value.class_requirements.flatMap((c) => c.name_patterns)];
    for (const d of ["amlodipine", "nifedipine", "diltiazem", "verapamil", "atenolol", "bisoprolol", "metoprolol", "propranolol", "carvedilol", "nebivolol"]) {
      expect(all).not.toContain(`%${d}%`);
    }
  });

  it("each class asks for the tests in the CMO's table", () => {
    const by = Object.fromEntries(cfg.value.class_requirements.map((c) => [c.key, c.requires]));
    expect(by["acei_arb"]).toEqual(["kidney_function", "potassium", "sodium"]);
    expect(by["thiazide"]).toEqual(["kidney_function", "potassium", "sodium", "glucose_or_hba1c"]);
    expect(by["metformin"]).toEqual(["kidney_function", "glucose_or_hba1c"]);
    expect(by["sulfonylurea_insulin"]).toEqual(["kidney_function", "hba1c", "glucose"]);
    expect(by["statin"]).toEqual([]);
  });

  it("every medicine named in a class is in a scope group, so the trigger reaches it", () => {
    const scope = new Set([
      ...cfg.value.drug_classes.bp_lowering.name_patterns,
      ...((getProposedConfig("prescribing.baseline_labs_rule", "2026-10-28").value as { drug_classes: { glucose_lowering: { name_patterns: string[] }; statins: { name_patterns: string[] } } }).drug_classes.glucose_lowering.name_patterns),
      ...((getProposedConfig("prescribing.baseline_labs_rule", "2026-10-28").value as { drug_classes: { statins: { name_patterns: string[] } } }).drug_classes.statins.name_patterns),
    ]);
    for (const c of cfg.value.class_requirements) for (const p of c.name_patterns) expect(scope.has(p)).toBe(true);
  });

  it("and every covered medicine belongs to a class, so none is in scope but silently asked for nothing", () => {
    const v = cfg.value as unknown as { drug_classes: Record<string, { name_patterns?: string[] }> };
    const inClass = new Set(cfg.value.class_requirements.flatMap((c) => c.name_patterns));
    for (const [group, body] of Object.entries(v.drug_classes)) {
      if (typeof body !== "object" || !Array.isArray(body.name_patterns)) continue;
      for (const p of body.name_patterns) expect({ group, p, covered: inClass.has(p) }).toEqual({ group, p, covered: true });
    }
  });
});
