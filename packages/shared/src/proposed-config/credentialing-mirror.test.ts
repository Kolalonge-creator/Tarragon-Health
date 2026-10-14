import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seededRules(): unknown {
  // The newest migration that seeds a rules row is the newest version (each new version adds a row; a proposed one is inserted inactive).
  const sqls = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .filter((sql) => sql.includes("credentialing-rules-begin"));
  const sql = sqls[sqls.length - 1];
  if (!sql) throw new Error("S15 migration not found");
  const match = /credentialing-rules-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
  if (!match?.[1]) throw new Error("credentialing rules seed not found in the migration");
  return JSON.parse(match[1]);
}

describe("credentialing.rules mirrors the migration seed", () => {
  it("is identical, so the registry and credentialing_config cannot drift", () => {
    expect(seededRules()).toEqual(getProposedConfig("credentialing.rules").value);
  });

  it("version 3 (S20 v2) carries the 90/30/7/0 notices, the 15 December proof deadline and the missing-date rule", () => {
    const v3 = getProposedConfig("credentialing.rules", "2026-10-14");
    expect(v3.version).toBe(3);
    expect(v3.status).toBe("proposed");
    const rules = v3.value as { notice_windows_days: number[]; renewal_cycle: Record<string, number>; missing_licence_date_ineligible: boolean; grace_max_days: number };
    expect(rules.notice_windows_days).toEqual([90, 30, 7, 0]);
    expect(rules.renewal_cycle).toEqual({ cycle_end_month: 12, cycle_end_day: 31, proof_deadline_month: 12, proof_deadline_day: 15 });
    expect(rules.missing_licence_date_ineligible).toBe(true);
    expect(rules.grace_max_days).toBe(14);
  });

  it("version 2 keeps the 90/30/0 notices (it was never edited)", () => {
    expect((getProposedConfig("credentialing.rules", "2026-10-06").value as { notice_windows_days: number[] }).notice_windows_days).toEqual([90, 30, 0]);
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
