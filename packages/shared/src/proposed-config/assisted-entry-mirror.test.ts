import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seed(): { max_per_helper_per_person_per_hour: number; max_per_helper_per_day: number } {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_assisted_entry_and_caregiver_red_care.sql"));
  if (!file) throw new Error("assisted entry migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const match = /assisted-entry-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
  if (!match?.[1]) throw new Error("assisted_entry_config seed not found in the migration");
  return JSON.parse(match[1]);
}

describe("assisted_entry limits mirror the migration seed", () => {
  it("the registry equals the seeded row", () => {
    expect(getProposedConfig("assisted_entry.limits").value).toEqual(seed());
  });
  it("the hourly limit never exceeds the daily one and both are positive whole numbers", () => {
    const v = getProposedConfig("assisted_entry.limits").value as { max_per_helper_per_person_per_hour: number; max_per_helper_per_day: number };
    expect(Number.isInteger(v.max_per_helper_per_person_per_hour)).toBe(true);
    expect(v.max_per_helper_per_person_per_hour).toBeGreaterThan(0);
    expect(v.max_per_helper_per_person_per_hour).toBeLessThanOrEqual(v.max_per_helper_per_day);
  });
});
