import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig, PROPOSED_CONFIG } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

type Rule = {
  drug_classes: { bp_lowering: { name_patterns: string[] }; glucose_lowering: { name_patterns: string[] } };
  required_baseline: { for_every_medicine_in_both_groups: string[]; additionally_if_diabetes_on_record: string[] };
  recency_window_days: number;
  when_labs_are_missing: { action: string; bypass_available: boolean };
  applies_to: { sources_checked: string[]; sources_never_checked: string[] };
};

describe("prescribing.baseline_labs_rule mirrors the migration seed", () => {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_baseline_labs_prescribing_rule.sql"));
  if (!file) throw new Error("baseline labs migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const cfg = getProposedConfig<Rule>("prescribing.baseline_labs_rule");

  it("is identical to the baseline_labs_rule_config v1 seed", () => {
    const match = /baseline-labs-rule-v1-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(cfg.value);
  });

  it("is PROPOSED and owned by the CMO, never signed in code", () => {
    const e = PROPOSED_CONFIG.find((x) => x.key === "prescribing.baseline_labs_rule");
    expect(e?.status).toBe("proposed");
    expect(e?.owner).toBe("CMO");
  });

  it("the migration seeds it unsigned and inactive and nothing in it signs", () => {
    expect(sql).toMatch(/values \(1, false, '2026-10-26'/);
    const seedPart = sql.slice(sql.indexOf("baseline-labs-rule-v1-begin"), sql.indexOf("baseline-labs-rule-v1-end"));
    expect(seedPart).not.toMatch(/approved_at|is_active\s*=\s*true/);
  });

  it("states the proposed rule: three labs for both groups, HbA1c for diabetes, 90 days, refuse with no bypass", () => {
    expect(cfg.value.required_baseline.for_every_medicine_in_both_groups).toEqual(["kidney_function", "potassium", "glucose"]);
    expect(cfg.value.required_baseline.additionally_if_diabetes_on_record).toEqual(["hba1c"]);
    expect(cfg.value.recency_window_days).toBe(90);
    expect(cfg.value.when_labs_are_missing).toMatchObject({ action: "refuse", bypass_available: false });
  });

  it("never checks a patient's own record or an import", () => {
    expect(cfg.value.applies_to.sources_checked).toEqual(["clinician", "specialist"]);
    expect(cfg.value.applies_to.sources_never_checked).toEqual(expect.arrayContaining(["patient", "fhir_import"]));
  });

  it("no em dash appears in any shown text", () => {
    expect(JSON.stringify(cfg.value)).not.toMatch(/—/);
  });
});
