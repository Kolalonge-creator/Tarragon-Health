import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function migrationSql(): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s21_encounters_consultations.sql"));
  if (!file) throw new Error("S21 migration not found");
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

describe("consultations.policy mirrors the migration seed", () => {
  it("is identical to consultation_policy_config version 1", () => {
    const match = /policy-v1-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(migrationSql());
    if (!match?.[1]) throw new Error("consultation policy seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(getProposedConfig("consultations.policy").value);
  });

  it("holds the founder's decisions (OQ-127, OQ-129)", () => {
    const v = getProposedConfig<{ minAgeYears: number; requireDateOfBirth: boolean; cancelWindowHours: number }>("consultations.policy").value;
    expect(v.minAgeYears).toBe(18);
    expect(v.requireDateOfBirth).toBe(true);
    expect(v.cancelWindowHours).toBe(2);
  });
});
