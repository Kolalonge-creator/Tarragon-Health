import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

describe("learning.max_lesson_minutes mirrors the database constant", () => {
  it("private.learning_max_lesson_minutes() returns the configured value", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s55_learning_governance_aliases_creators.sql"));
    if (!file) throw new Error("S55 governance migration not found");
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const match = /function private\.learning_max_lesson_minutes\(\)[\s\S]*?as \$\$ select (\d+) \$\$/.exec(sql);
    if (!match?.[1]) throw new Error("could not read the lesson limit from the migration");
    expect(Number(match[1])).toBe(getProposedConfig("learning.max_lesson_minutes").value);
  });
});
