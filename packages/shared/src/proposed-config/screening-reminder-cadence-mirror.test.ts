import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function migrationSql(suffix: string): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`migration ending ${suffix} not found`);
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

function seeded(version: 1 | 2): unknown {
  const sql = migrationSql("_t2_screening_reminder_cadence_and_defer.sql");
  const block = new RegExp(`screening-reminder-config-v${version}-begin([\\s\\S]*?)screening-reminder-config-v${version}-end`).exec(sql)?.[1] ?? "";
  const json = /\$json\$([\s\S]*?)\$json\$/.exec(block)?.[1];
  if (!json) throw new Error(`v${version} seed not found`);
  return JSON.parse(json);
}

type Step = { code: string; offsetDays: number; untilDays: number | null; stage: string; push: boolean };
type Cadence = { steps: Step[]; coordinatorFollowUp: { afterStage: string }; defer: unknown };

describe("screening.reminder_cadence mirrors screening_reminder_configs", () => {
  it("v1 is the seeded history row and v2 the active one, value for value", () => {
    expect(getProposedConfig("screening.reminder_cadence", "2026-11-03").value).toEqual(seeded(1));
    const live = getProposedConfig<Cadence>("screening.reminder_cadence", "2026-11-04");
    expect(live.version).toBe(2);
    expect(live.value).toEqual(seeded(2));
  });

  it("v2 is the founder's timing: 14, 7 and 1 day before, 7 and 30 days overdue, and the last step is the stage the coordinator sweep reads", () => {
    const v = getProposedConfig<Cadence>("screening.reminder_cadence", "2026-11-04").value;
    expect(v.steps.map((s) => s.offsetDays)).toEqual([-14, -7, -1, 7, 30]);
    expect(v.steps[v.steps.length - 1].stage).toBe(v.coordinatorFollowUp.afterStage);
    // windows never overlap backwards: each step starts after the one before
    for (let i = 1; i < v.steps.length; i++) expect(v.steps[i].offsetDays).toBeGreaterThan(v.steps[i - 1].offsetDays);
    expect(v.defer).not.toBeNull();
  });

  it("the migration activates v2 and keeps v1 inactive", () => {
    const sql = migrationSql("_t2_screening_reminder_cadence_and_defer.sql");
    expect(sql).toMatch(/\(1, false, '2026-08-28'/);
    expect(sql).toMatch(/\(2, true, '2026-11-04'/);
  });
});
