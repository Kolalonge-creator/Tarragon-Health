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

describe("written_care.behaviour mirrors the migration seed", () => {
  it("is identical to the written_care_config seed", () => {
    const match = /written-care-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(migration("_s22_written_questions.sql"));
    if (!match?.[1]) throw new Error("written care seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(getProposedConfig("written_care.behaviour").value);
  });

  it("the founder's decisions hold: 24 hour window, 7 day follow-up, timezone Lagos", () => {
    const v = getProposedConfig("written_care.behaviour").value as { windowMinutes: number; followUpDays: number; timezone: string };
    expect(v.windowMinutes).toBe(1440);
    expect(v.followUpDays).toBe(7);
    expect(v.timezone).toBe("Africa/Lagos");
  });

  it("the call task type seeded by S22 is a class 5 task due in 24 hours", () => {
    const sql = migration("_s22_written_questions.sql");
    const block = /task-types-b-begin([\s\S]*?)task-types-b-end/.exec(sql)?.[1] ?? "";
    expect(block).toContain("'written_question_call', 1, 5, 1440");
  });
});
