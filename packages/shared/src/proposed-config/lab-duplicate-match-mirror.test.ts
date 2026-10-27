import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seeded(): Record<string, unknown> {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_duplicate_lab_value_safety.sql"));
  if (!file) throw new Error("duplicate lab value safety migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const match = /lab-match-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
  if (!match?.[1]) throw new Error("match config seed not found in the migration");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("lab_value.duplicate_match mirrors the migration seed", () => {
  it("is identical, so the registry and lab_value_match_config cannot drift", () => {
    expect(seeded()).toEqual(getProposedConfig("lab_value.duplicate_match").value);
  });

  it("is proposed (unconfirmed) and never matches a unit that differs", () => {
    const c = getProposedConfig("lab_value.duplicate_match");
    expect(c.status).toBe("proposed");
    expect((c.value as { require_same_unit: boolean }).require_same_unit).toBe(true);
  });
});
