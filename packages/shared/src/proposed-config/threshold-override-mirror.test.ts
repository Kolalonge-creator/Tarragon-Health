import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");
const sql = (): string => {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_n_patient_threshold_overrides.sql"));
  if (!file) throw new Error("N-overrides migration not found");
  return readFileSync(join(MIGRATIONS, file), "utf8");
};

describe("personal threshold overrides: code, config and migration agree (N-overrides)", () => {
  it("the policy entry is identical to the threshold_override_policies v1 seed, which ships unsigned", () => {
    const match = /threshold-override-policy-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql());
    if (!match?.[1]) throw new Error("policy seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(getProposedConfig("triage.threshold_override_policy").value);
    expect(sql()).toMatch(/the policy must be born unsigned and inactive/);
  });
  it("the review task type is routine and never pushed", () => {
    const block = /task-types-threshold-override-begin([\s\S]*?)task-types-threshold-override-end/.exec(sql())?.[1] ?? "";
    expect(block).toMatch(/'threshold_override_review', 1, 8, 4320, 'senior_medical_officer', '\{\}', 0, 30, false, true/);
  });
});
