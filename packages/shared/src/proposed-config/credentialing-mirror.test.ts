import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seededRules(): unknown {
  // The seed with the highest credentialing_config VERSION is the newest set of rules (each new version adds a row). File order is not
  // used: a later-dated migration can seed a lower version (version 4, S76 re-verification, was written before version 3, P5, merged).
  const sqls = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .filter((sql) => sql.includes("credentialing-rules-begin"))
    .map((sql) => ({ sql, version: Number(/credentialing_config \(version[^)]*\)\s*values\s*\((\d+)/.exec(sql)?.[1] ?? 0) }))
    .sort((a, b) => a.version - b.version);
  const sql = sqls[sqls.length - 1]?.sql;
  if (!sql) throw new Error("S15 migration not found");
  const match = /credentialing-rules-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
  if (!match?.[1]) throw new Error("credentialing rules seed not found in the migration");
  return JSON.parse(match[1]);
}

describe("credentialing.rules mirrors the migration seed", () => {
  it("is identical, so the registry and credentialing_config cannot drift", () => {
    expect(seededRules()).toEqual(getProposedConfig("credentialing.rules").value);
  });

  it("agrees with the clinician.* spec values it repeats", () => {
    const rules = getProposedConfig("credentialing.rules").value as Record<string, unknown>;
    expect(rules.min_practice_years).toBe(getProposedConfig("clinician.min_practice_years_after_house_job").value);
    expect(rules.audited_task_count).toBe(getProposedConfig("clinician.tier1_audited_task_count").value);
    const test = getProposedConfig("clinician.training_test").value as { passPercent: number; allRedScenariosCorrect: boolean };
    expect(rules.pass_percent).toBe(test.passPercent);
    expect(rules.all_red_correct).toBe(test.allRedScenariosCorrect);
  });
});
